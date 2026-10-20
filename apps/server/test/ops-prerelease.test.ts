/**
 * The switch for new versions on Asetukset > Ylläpito: two requests without a value, behind the gate of `restart`.
 * What the helper does with them on the host is in tools/test/channel.test.sh.
 */
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { ACTION_SINCE, helperKnows, NEEDS_PASSWORD, normaliseState, OPS_ACTIONS, parseOpsRequest, READ_ONLY } from "../src/services/ops-validate.ts";
import { NOW, setupApp } from "./helpers.ts";

type Services = Awaited<ReturnType<typeof setupApp>>["s"];
const SWITCH = ["prerelease-on", "prerelease-off"] as const;

/** A clock the test can move. */
function clock() {
  let t = NOW.getTime();
  return { now: () => new Date(t), advance: (ms: number) => void (t += ms) };
}

/** Runs the ops CLI the way the helper does and returns the one JSON line it prints. */
async function cli(s: Services, args: string[], stdin = "") {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(m));
  try {
    expect(await runCli(s, ["ops", ...args], { readStdin: async () => stdin })).toBe(0);
  } finally {
    spy.mockRestore();
  }
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!);
}
const helperOn = (s: Services, version: string, state: object = {}) => cli(s, ["state", "--helper", version], JSON.stringify(state));

describe("ops: the switch for new versions", () => {
  it("is two names without a value, known from helper version 4, mutating and without a password", () => {
    for (const action of SWITCH) {
      expect(OPS_ACTIONS).toContain(action);
      expect(ACTION_SINCE[action]).toBe(4);
      expect(parseOpsRequest({ action })).toMatchObject({ action });
      expect(READ_ONLY.includes(action), action).toBe(false);
      expect(NEEDS_PASSWORD.includes(action), action).toBe(false);
      for (const old of [null, "1", "2", "3", "garbage", "3.9", ""]) expect(helperKnows(old, action), `${action} ${old}`).toBe(false);
      expect(helperKnows("4", action)).toBe(true);
      expect(helperKnows("5", action)).toBe(true);
      // the position is in the name: nothing can travel with it
      for (const params of [{ value: "yes" }, { prerelease: "yes" }, { TALOUS_PRERELEASE: "yes" }, []]) expect(() => parseOpsRequest({ action, params }), JSON.stringify(params)).toThrow();
    }
    for (const action of ["prerelease", "prerelease-yes", "prerelease-on ", "Prerelease-on", "prerelease-on\nTALOUS_CHANNEL=source", "prerelease_on"]) {
      expect(() => parseOpsRequest({ action }), JSON.stringify(action)).toThrow();
    }
  });

  it("an older helper is refused before a row is stored, and the answer names the command that renews it", async () => {
    const { admin, s } = await setupApp();
    for (const version of ["1", "2", "3"]) {
      await helperOn(s, version);
      for (const action of SWITCH) {
        const r = await admin.call("POST", "/api/ops/request", { action });
        expect(r.status, `${action} from version ${version}`).toBe(409);
        expect(r.body.error).toContain("./scripts/install.sh --ops-helper");
      }
      expect((await admin.call("GET", "/api/ops/state")).body.helper.knowsPrerelease, version).toBe(false);
    }
    expect(await s.ops.recent(5)).toEqual([]);
    await helperOn(s, "4");
    expect((await admin.call("GET", "/api/ops/state")).body.helper.knowsPrerelease).toBe(true);
    expect((await admin.call("POST", "/api/ops/request", { action: "prerelease-on" })).status).toBe(200);
  });

  it("a member cannot ask for it, and a name outside the list is refused: nothing is written", async () => {
    const { admin, member, s } = await setupApp();
    await helperOn(s, "4");
    const eero = await member("eero");
    for (const action of SWITCH) expect((await eero.call("POST", "/api/ops/request", { action })).status, action).toBe(403);
    for (const body of [{ action: "prerelease" }, { action: "prerelease-on", params: { value: "no" } }, { action: "prerelease-on", value: "yes" }]) {
      expect((await admin.call("POST", "/api/ops/request", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await s.ops.recent(5)).toEqual([]);
  });

  it("passes the gate of restart: no password, the one slot, once a minute, the audit line and the notice to the other admins", async () => {
    const t = clock();
    const { admin, s, adminId } = await setupApp({}, undefined, { now: t.now });
    await helperOn(s, "4");
    expect((await admin.call("POST", "/api/users", { username: "kaisa", displayName: "Kaisa", role: "admin" })).status).toBe(201);
    const r = await admin.call("POST", "/api/ops/request", { action: "prerelease-on" });
    expect(r.status).toBe(200);
    expect(r.body.request).toMatchObject({ action: "prerelease-on", label: "uudet versiot tarjolle heti", status: "queued", by: "aino" });
    const id: string = r.body.request.id;
    expect((await admin.call("GET", "/api/ops/audit")).body.events[0]).toMatchObject({ username: "aino", action: "uudet versiot tarjolle heti", outcome: "jonossa" });
    // the one slot: nothing else that changes the host fits beside it, and the refusal is in the journal too
    for (const action of ["restart", "backup", "prerelease-off"]) expect((await admin.call("POST", "/api/ops/request", { action })).status, action).toBe(409);
    expect((await admin.call("GET", "/api/ops/audit")).body.events[0]).toMatchObject({ action: "uudet versiot tarjolle kahden päivän päästä", outcome: "kielletty, toinen kesken" });
    expect((await s.security.unseenNotices(adminId)).filter((e) => e.kind === "ops_notice")).toHaveLength(0);
    const kaisa = (await s.users.findForLogin("kaisa"))!;
    const notices = await s.security.unseenNotices(kaisa.id);
    expect(notices.map((e) => e.kind)).toEqual(["ops_notice"]);
    expect(notices[0]!.detail).toContain("Aino käynnisti toiminnon: uudet versiot tarjolle heti");
    // the helper gets the name and nothing with it
    expect(await cli(s, ["poll", "--helper", "4", "--done", ""])).toEqual({ request: { id, action: "prerelease-on", params: {}, secret: null } });
    await cli(s, ["report"], JSON.stringify({ id, status: "ok", exit_code: 0, summary: "Uudet versiot tarjotaan heti.", state: { prerelease: "yes", channel: "release" } }));
    expect((await admin.call("GET", "/api/ops/state")).body.state).toMatchObject({ prerelease: "yes", channel: "release" });
    // once a minute, as for restart
    t.advance(30_000);
    await helperOn(s, "4");
    const quick = await admin.call("POST", "/api/ops/request", { action: "prerelease-off" });
    expect(quick.status).toBe(429);
    expect(quick.res.headers.get("retry-after")).toBe("60");
    t.advance(31_000);
    await helperOn(s, "4");
    const off = await admin.call("POST", "/api/ops/request", { action: "prerelease-off" });
    expect(off.status).toBe(200);
    expect(off.body.request.label).toBe("uudet versiot tarjolle kahden päivän päästä");
  });

  it("a helper that went back to an older version is never handed the request", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s, "4");
    const id: string = (await admin.call("POST", "/api/ops/request", { action: "prerelease-on" })).body.request.id;
    expect(await cli(s, ["poll", "--helper", "3", "--done", ""])).toEqual({ request: null });
    expect((await s.ops.get(id))!).toMatchObject({ status: "failed", summary: "Apuri ei tue tätä toimintoa." });
  });

  it("the poll hands out no row whose action is not one of the allowed names, which the table has not limited since migration 0017", async () => {
    const { s, adminId } = await setupApp();
    await helperOn(s, "4");
    for (const [i, action] of ["rm -rf", "prerelease", "prerelease-on; id", "port", "PRERELEASE-ON"].entries()) {
      const id = `op_00000000000000b${i}`;
      await s.db.run("INSERT INTO ops_requests (id, action, params, requested_by, requested_at) VALUES (?, ?, '{}', ?, ?)", [id, action, adminId, NOW.toISOString()]);
      expect(await cli(s, ["poll", "--helper", "4", "--done", ""]), action).toEqual({ request: null });
      expect((await s.ops.get(id))!, action).toMatchObject({ status: "failed", summary: "Virheellinen pyyntö." });
    }
  });

  it("the position the helper reports reaches the page, and anything but its four words is dropped", async () => {
    const { admin, s } = await setupApp();
    const state = async () => (await admin.call("GET", "/api/ops/state")).body.state;
    await helperOn(s, "4", { prerelease: "no", channel: "release" });
    expect(await state()).toMatchObject({ prerelease: "no", channel: "release" });
    await helperOn(s, "4", { prerelease: "yes", channel: "source" });
    expect(await state()).toMatchObject({ prerelease: "yes", channel: "source" });
    // a tick that says nothing about the switch leaves the stored position alone
    await helperOn(s, "4");
    expect(await state()).toMatchObject({ prerelease: "yes", channel: "source" });
    await helperOn(s, "4", { channel: "private" });
    expect(await state()).toMatchObject({ channel: "private" });
    for (const bad of [{ prerelease: "true" }, { prerelease: true }, { prerelease: "YES" }, { prerelease: ["yes"] }, { channel: "main" }, { channel: 1 }, { prerelease: "<b>yes</b>" }]) {
      const out = normaliseState(bad);
      expect(out.prerelease, JSON.stringify(bad)).toBeUndefined();
      expect(out.channel, JSON.stringify(bad)).toBeUndefined();
    }
  });
});
