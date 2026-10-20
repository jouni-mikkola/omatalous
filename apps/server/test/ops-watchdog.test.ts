import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { parseWatchdog } from "../src/services/ops-watchdog.ts";
import { noticesFor, recordEvent } from "../src/services/security.ts";
import { NOW, setupApp } from "./helpers.ts";

type App = Awaited<ReturnType<typeof setupApp>>;

const IDLE = '{"request":null}';
const OK = '{"ok":true}';

/** A clock the test can move. */
function clock() {
  let t = NOW.getTime();
  return { now: () => new Date(t), advance: (ms: number) => void (t += ms) };
}

/** Runs the ops CLI the way the helper does and returns the one line it prints, as the text the helper matches. */
async function line(s: App["s"], args: string[], stdin = ""): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(m));
  try {
    expect(await runCli(s, ["ops", ...args], { readStdin: async () => stdin })).toBe(0);
  } finally {
    spy.mockRestore();
  }
  expect(lines).toHaveLength(1);
  return lines[0]!;
}

/** Rows inserted, updated or deleted on the connection so far: it moves with any write, also one that stores the same value again. */
const written = async (db: App["db"]) => (await db.first<{ n: number }>("SELECT total_changes() AS n"))!.n;

describe("ops poll --dry", () => {
  it("prints the idle line while a request is queued, hands nothing out and writes nothing", async () => {
    const t = clock();
    const { admin, s, db } = await setupApp({}, undefined, { now: t.now });
    await line(s, ["state", "--helper", "3"], "{}");
    const id = (await admin.call("POST", "/api/ops/request", { action: "check-update" })).body.request.id as string;
    t.advance(60_000);
    const before = await written(db);
    expect(await line(s, ["poll", "--dry", "--helper", "3"])).toBe(IDLE);
    // wherever the flag stands, and a --done beside it fails no row
    expect(await line(s, ["poll", "--helper", "3", "--done", id, "--dry"])).toBe(IDLE);
    expect(await line(s, ["poll", "--dry"])).toBe(IDLE);
    expect(await written(db)).toBe(before);
    expect((await s.ops.get(id))!.status).toBe("queued");
    // without the flag the poll is what it was: the request, in the line the helper matches as text
    expect(await line(s, ["poll", "--helper", "3", "--done", ""])).toBe(`{"request":{"id":"${id}","action":"check-update","params":{},"secret":null}}`);
    expect((await s.ops.get(id))!.status).toBe("running");
    expect(await written(db)).toBeGreaterThan(before);
    expect(await line(s, ["poll", "--helper", "3", "--done", ""])).toBe(IDLE);
  });

  it("moves no seen time, stores no version, lets no request expire and records no event", async () => {
    const t = clock();
    const { admin, s } = await setupApp({}, undefined, { now: t.now });
    await line(s, ["state", "--helper", "3"], "{}");
    const id = (await admin.call("POST", "/api/ops/request", { action: "check-update" })).body.request.id as string;
    const seen = await s.settings.get("ops_helper_seen");
    const events = async () => (await s.security.list({ limit: 500 })).length;
    const count = await events();
    // past the ten minutes after which a poll lets a queued request expire
    t.advance(11 * 60_000);
    expect(await line(s, ["poll", "--dry", "--helper", "9"])).toBe(IDLE);
    expect(await s.settings.get("ops_helper_seen")).toBe(seen);
    expect(await s.settings.get("ops_helper_version")).toBe("3");
    expect((await s.ops.get(id))!.status).toBe("queued");
    expect(await events()).toBe(count);
    // the poll without the flag does each of them
    expect(await line(s, ["poll", "--helper", "9"])).toBe(IDLE);
    expect(await s.settings.get("ops_helper_seen")).toBe(t.now().toISOString());
    expect(await s.settings.get("ops_helper_version")).toBe("9");
    expect((await s.ops.get(id))!.status).toBe("expired");
    expect(await events()).toBe(count + 1);
  });

  it("does not make a helper that never polled count as seen", async () => {
    const { admin, s } = await setupApp();
    expect(await line(s, ["poll", "--dry", "--helper", "3"])).toBe(IDLE);
    expect((await admin.call("GET", "/api/ops/state")).body.helper).toMatchObject({ status: "off", reason: "never", seenAt: null, version: null });
  });
});

const REPORT = { at: "2026-10-09T09:40:00Z", from: "0.9.1", to: "0.9.0", reason: "unhealthy" };
/** The one name of a rollback, then the reason, then the two versions: the host helper's sentence (scripts/lib/ops-watchdog.sh) goes as far as the reason. */
const UNHEALTHY = "Edellinen versio palautettiin, koska sovellus ei vastannut 10 minuuttiin. Versiosta 0.9.1 palattiin versioon 0.9.0";
const SELF_TEST = "Edellinen versio palautettiin, koska uusi ylläpitoapuri ei toiminut. Versiosta 0.9.1 palattiin versioon 0.9.0";
/** NOW on Helsinki time, the way a notice ends with its own time. */
const TOLD_AT = "(9.10. klo 13.00)";
const MAINTENANCE = (kind: string) => kind === "watchdog_notice" || kind.startsWith("ops_");

/** Two admins and a member in a copy on Helsinki time, with what each is told about maintenance and what the event list holds. */
async function household() {
  const app = await setupApp();
  expect((await app.admin.call("PUT", "/api/admin/instance", { timezone: "Europe/Helsinki" })).status).toBe(200);
  const kaisa = await app.admin.call("POST", "/api/users", { username: "kaisa", displayName: "Kaisa", role: "admin" });
  expect(kaisa.status).toBe(201);
  const matti = await app.member("matti");
  const notices = async (id: string, role: string) => (await noticesFor(app.s, { id, role })).filter((n) => MAINTENANCE(n.kind)).map((n) => n.text);
  const events = async () => (await app.s.security.list({ kind: "ops_watchdog", limit: 50 })).map((e) => e.detail);
  return { ...app, admins: [app.adminId, kaisa.body.user.id as string], mattiId: matti.id, notices, events };
}

describe("ops state: the watchdog report", () => {
  it("is read in one form, and keys beside the four are left out", () => {
    const read = { at: "2026-10-09T09:40:00.000Z", from: "0.9.1", to: "0.9.0", reason: "unhealthy" };
    expect(parseWatchdog({ watchdog: REPORT })).toEqual(read);
    expect(parseWatchdog({ mode: "lan", watchdog: { ...REPORT, at: "2026-10-09T09:40:00.000Z", note: "x", path: "/etc/passwd" } })).toEqual(read);
    expect(parseWatchdog({ watchdog: { ...REPORT, from: "10.20.30", to: "10.20.29", reason: "self_test" } })).toEqual({ ...read, from: "10.20.30", to: "10.20.29", reason: "self_test" });
  });

  it("becomes one event and a notice to every admin in a sentence of its own, and a member sees none", async () => {
    const h = await household();
    expect(await line(h.s, ["state", "--helper", "3"], JSON.stringify({ watchdog: REPORT }))).toBe(OK);
    expect(await h.events()).toEqual([`päivitys: ${UNHEALTHY}`]);
    // the whole notice: the sentence and the notice's own time, and no word about asking the admin
    for (const id of h.admins) expect(await h.notices(id, "admin")).toEqual([`${UNHEALTHY} ${TOLD_AT}.`]);
    expect(await h.notices(h.mattiId, "member")).toEqual([]);
    expect((await h.s.security.unseenNotices(h.mattiId)).filter((e) => MAINTENANCE(e.kind))).toEqual([]);
    // the audit list of the maintenance page has it once, as an action and how it ended
    const audit = (await h.admin.call("GET", "/api/ops/audit")).body.events;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "päivitys", outcome: UNHEALTHY });
    // the security list has the event once, by nobody, and beside it who was told
    const listed = async (kind: string) => ((await h.admin.call("GET", `/api/security/events?kind=${kind}`)).body.events as { username: string | null }[]).map((e) => e.username);
    expect(await listed("ops_watchdog")).toEqual([null]);
    expect((await listed("watchdog_notice")).sort()).toEqual(["aino", "kaisa"]);
    expect(await listed("ops_notice")).toEqual([]);
  });

  it("is told by the next state when its rows could not be written, all of them or one", async () => {
    const h = await household();
    const send = (watchdog: unknown) => line(h.s, ["state", "--helper", "3"], JSON.stringify({ watchdog }));
    const insert = h.s.security.insert.bind(h.s.security);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // no row can be written: recordEvent keeps that to itself, and the helper still gets its answer
      const locked = vi.spyOn(h.s.security, "insert").mockRejectedValue(new Error("database is locked"));
      expect(await send(REPORT)).toBe(OK);
      locked.mockRestore();
      expect(await h.events()).toEqual([]);
      expect(await h.s.settings.get("ops_watchdog_at")).toBeNull();
      // the same report again is told now, and then no more
      await send(REPORT);
      await send(REPORT);
      expect(await h.events()).toEqual([`päivitys: ${UNHEALTHY}`]);
      for (const id of h.admins) expect(await h.notices(id, "admin")).toEqual([`${UNHEALTHY} ${TOLD_AT}.`]);
      expect(await h.s.settings.get("ops_watchdog_at")).toBe("2026-10-09T09:40:00.000Z");

      // a later report loses its third row, the notice of one admin: the round is not marked
      const later = { ...REPORT, at: "2026-10-09T09:55:00Z", reason: "self_test" };
      let rows = 0;
      const third = vi.spyOn(h.s.security, "insert").mockImplementation((e) => (++rows === 3 ? Promise.reject(new Error("database is locked")) : insert(e)));
      await send(later);
      third.mockRestore();
      expect(await h.s.settings.get("ops_watchdog_at")).toBe("2026-10-09T09:40:00.000Z");
      // the next state tells all of it, so the admin whose row was written reads it twice, and after that it is marked
      await send(later);
      await send(later);
      expect(await h.s.settings.get("ops_watchdog_at")).toBe("2026-10-09T09:55:00.000Z");
      const told = await Promise.all(h.admins.map(async (id) => (await h.notices(id, "admin")).filter((text) => text === `${SELF_TEST} ${TOLD_AT}.`).length));
      expect(told.sort()).toEqual([1, 2]);
    } finally {
      logged.mockRestore();
    }
  });

  it("is recorded once for an at, however often and in whichever way the helper repeats it", async () => {
    const h = await household();
    const report = (state: unknown) => JSON.stringify({ id: "op_0123456789abcdef", status: "ok", state });
    await line(h.s, ["state", "--helper", "3"], JSON.stringify({ mode: "lan", watchdog: REPORT }));
    await line(h.s, ["state", "--helper", "3"], JSON.stringify({ mode: "lan", watchdog: REPORT }));
    await line(h.s, ["state", "--helper", "3"], JSON.stringify({ state: { watchdog: REPORT } }));
    await line(h.s, ["state", "--helper", "3"], JSON.stringify({ watchdog: { ...REPORT, at: "2026-10-09T09:40:00.000Z" } }));
    expect(await line(h.s, ["report", "--helper", "3"], report({ watchdog: REPORT }))).toBe(OK);
    expect(await h.events()).toHaveLength(1);
    for (const id of h.admins) expect(await h.notices(id, "admin")).toHaveLength(1);
    // the rest of the state is taken in as before
    expect((await h.admin.call("GET", "/api/ops/state")).body.state).toMatchObject({ mode: "lan" });

    // a later rollback has a new at, here inside a report: told once more, with its own reason
    const later = { ...REPORT, at: "2026-10-09T09:55:00Z", reason: "self_test" };
    await line(h.s, ["report", "--helper", "3"], report({ watchdog: later }));
    await line(h.s, ["state", "--helper", "3"], JSON.stringify({ watchdog: later }));
    expect((await h.events()).sort()).toEqual([`päivitys: ${SELF_TEST}`, `päivitys: ${UNHEALTHY}`].sort());
    for (const id of h.admins) expect(await h.notices(id, "admin")).toEqual([`${UNHEALTHY} ${TOLD_AT}.`, `${SELF_TEST} ${TOLD_AT}.`]);
    expect(await h.notices(h.mattiId, "member")).toEqual([]);
  });

  it("is dropped in every other shape, and then nothing is recorded, told or logged", async () => {
    const { at, from, to, reason } = REPORT;
    const versions = ["v0.9.1", "0.9", "0.9.1-rc1", "0.9.1\n", " 0.9.1", "0.9.1.1", "latest", "", "../0.9.1", "0.9.1;id", "$(id)", "1111111111.1111111111.1", 91, null, ["0.9.1"]];
    const bad: unknown[] = [
      // not an object
      null, "unhealthy", 7, true, [], [REPORT],
      // a field missing
      {}, { from, to, reason }, { at, to, reason }, { at, from, reason }, { at, from, to },
      // at: no time, a time in another form, a time that does not exist, over 40 characters, not a string
      ...["yesterday", "2026-10-09", "2026-10-09 09:40:00Z", "2026-10-09T09:40:00+03:00", "2026-13-45T09:40:00Z", "2026-10-09T09:40:00Z\n", " 2026-10-09T09:40:00Z", `2026-10-09T09:40:00.${"0".repeat(30)}Z`, "", 1760002800, null, [at]].map((v) => ({ ...REPORT, at: v })),
      // from and to: anything but X.Y.Z of at most 20 characters
      ...versions.flatMap((v) => [{ ...REPORT, from: v }, { ...REPORT, to: v }]),
      // reason: anything but the two words
      ...["", "broken", "UNHEALTHY", "unhealthy ", "unhealthy\n", "self-test", null, 1, ["unhealthy"]].map((v) => ({ ...REPORT, reason: v })),
    ];
    for (const b of bad) expect(parseWatchdog({ watchdog: b }), JSON.stringify(b)).toBeNull();
    // a state that is no object, or has the report under another name
    for (const state of [null, "watchdog", 7, [], [{ watchdog: REPORT }], {}, { Watchdog: REPORT }, REPORT]) expect(parseWatchdog(state), JSON.stringify(state)).toBeNull();

    const h = await household();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const b of bad) expect(await line(h.s, ["state", "--helper", "3"], JSON.stringify({ mode: "lan", watchdog: b })), JSON.stringify(b)).toBe(OK);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
    expect(await h.events()).toEqual([]);
    for (const id of h.admins) expect(await h.notices(id, "admin")).toEqual([]);
    expect(await h.s.settings.get("ops_watchdog_at")).toBeNull();
    // a report in form after them is still the first one
    await line(h.s, ["state", "--helper", "3"], JSON.stringify({ watchdog: REPORT }));
    expect(await h.events()).toHaveLength(1);
  });

  it("names a rollback in one way: the event, the notice, its fallback and the reason of each cause", async () => {
    const h = await household();
    await line(h.s, ["state", "--helper", "3"], JSON.stringify({ watchdog: REPORT }));
    await line(h.s, ["state", "--helper", "3"], JSON.stringify({ watchdog: { ...REPORT, at: "2026-10-09T09:55:00Z", reason: "self_test" } }));
    const NAME = "Edellinen versio palautettiin";
    const sentences = [...(await h.events()).map((e) => e!.replace(/^päivitys: /, "")), ...(await h.notices(h.adminId, "admin"))];
    expect(sentences).toHaveLength(4);
    for (const text of sentences) {
      expect(text.startsWith(`${NAME}, koska `), text).toBe(true);
      expect(text).not.toMatch(/palautti|palautettiin versioon|^Päivitys /);
    }
    // a notice row without its sentence still starts with the name
    await recordEvent(h.s, { kind: "watchdog_notice", userId: h.mattiId, notify: true });
    expect(await h.notices(h.mattiId, "member")).toEqual([`${NAME} ${TOLD_AT}.`]);
  });
});
