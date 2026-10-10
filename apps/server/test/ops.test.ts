import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { openDatabase } from "../src/db/open.ts";
import { helperStatus, LOGS_MAX_BYTES, LOGS_MAX_LINES, normaliseState, parseOpsRequest, parseSteps, sanitiseOutput } from "../src/services/ops-validate.ts";
import { NOW, setupApp } from "./helpers.ts";

const PASSWORD = "aino-salasana-123";
const XSS = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', "javascript:alert(1)", '"><svg onload=alert(1)>'];

/** A clock the test can move. */
function clock() {
  let t = NOW.getTime();
  return { now: () => new Date(t), advance: (ms: number) => void (t += ms) };
}

/** Runs the ops CLI the way the helper does and returns the one JSON line it prints. */
async function cli(s: Awaited<ReturnType<typeof setupApp>>["s"], args: string[], stdin = "") {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(m));
  try {
    const code = await runCli(s, ["ops", ...args], { readStdin: async () => stdin });
    expect(code).toBe(0);
  } finally {
    spy.mockRestore();
  }
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!);
}

const helperOn = (s: Awaited<ReturnType<typeof setupApp>>["s"], version = "2") => cli(s, ["state", "--helper", version], "{}");
const ROUTES: [string, string, unknown?][] = [
  ["GET", "/api/ops/state"],
  ["GET", "/api/ops/audit"],
  ["POST", "/api/ops/request", { action: "doctor" }],
  ["POST", "/api/ops/cancel/op_0123456789abcdef", {}],
  ["POST", "/api/ops/backups/latest", { password: "x" }],
];

describe("ops: validation", () => {
  it("accepts the nine actions and nothing else", () => {
    for (const action of ["update", "rollback", "backup", "restart", "doctor", "check-update", "logs", "prune", "helper-renew"]) expect(parseOpsRequest({ action }).action).toBe(action);
    for (const bad of [{ action: "logs", params: { service: "banking" } }, { action: "prune", params: { all: true } }, { action: "helper-renew", params: { args: "--ops-policy" } }, { action: "Logs" }, { action: "helper_renew" },{ action: "access" }, { action: "port" }, { action: "rm -rf /" }, { action: "update; id" }, { action: 1 }, {}, { action: "update", extra: 1 }, { action: "update", params: { ref: "main" } }, { action: "update", params: [] }, { action: "update", password: 5 }]) {
      expect(() => parseOpsRequest(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("scrubs output: ANSI, control characters, keys, tokens, the app secret, and keeps the tail", () => {
    const key = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
    const out = sanitiseOutput(
      `\x1b[31mred\x1b[0m\x07bell\nTUNNEL_TOKEN=abc\nAuthorization: Bearer xyz\n${key}\nrun ${"A".repeat(50)} end\nmy-very-long-app-secret-value`,
      ["my-very-long-app-secret-value"],
    );
    expect(out).toContain("redbell");
    expect(out).not.toMatch(/\x1b|\x07/);
    expect(out).not.toMatch(/abc|Bearer|MIIEv|AAAAA|app-secret/);
    expect(out).toContain("TUNNEL_TOKEN=[piilotettu]");
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const cut = sanitiseOutput(long);
    expect(cut.split("\n")).toHaveLength(200);
    expect(cut.endsWith("line 499")).toBe(true);
    expect(Buffer.byteLength(sanitiseOutput("ä".repeat(30000)))).toBeLessThanOrEqual(16 * 1024);
  });

  it("hides bearer tokens and Enable Banking JWTs, also short ones", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJlbmFibGViYW5raW5nLmNvbSJ9.c2ln";
    const out = sanitiseOutput(`GET /x Bearer abc.def\nsession ${jwt} ok\nid eyJhbGciOiJSUzI1NiJ9 done\nplain line`);
    expect(out).not.toMatch(/abc\.def|eyJ|c2ln/);
    expect(out).toContain("plain line");
  });

  it("the logs action may return more than the 200 lines other actions keep", () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    expect(sanitiseOutput(text, [], { lines: LOGS_MAX_LINES, bytes: LOGS_MAX_BYTES }).split("\n")).toHaveLength(LOGS_MAX_LINES);
    expect(sanitiseOutput(text).split("\n")).toHaveLength(200);
  });

  it("reads STEP lines", () => {
    expect(parseSteps("noise\nSTEP: 2/6 Varmuuskopio\nSTEP: x/y no\n")).toEqual([{ n: 2, m: 6, text: "Varmuuskopio" }]);
  });

  it("helper status at the 3 minute and 24 hour edges", () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(helperStatus(null, NOW)).toEqual({ status: "off", reason: "never" });
    expect(helperStatus(at(179_000), NOW).status).toBe("ok");
    expect(helperStatus(at(180_000), NOW).status).toBe("slow");
    expect(helperStatus(at(24 * 3600_000), NOW).status).toBe("slow");
    expect(helperStatus(at(24 * 3600_000 + 1000), NOW)).toEqual({ status: "off", reason: "stale" });
  });

  it("normalises a snapshot from outside: unknown keys, bad shapes and long text are dropped or cut", () => {
    const s = normaliseState({
      version: "0.4.0",
      evil: "x",
      commit: "not hex",
      update_available: "yes",
      behind_commits: [{ hash: "abc1234", subject: `${XSS[0]} ${"x".repeat(300)}` }, { hash: "../../", subject: "bad" }],
      backups: [{ name: "../x.db.gz", size: 1, at: "2026-10-09T10:00:00Z", kind: "daily" }, { name: "a.db.gz", size: 5, at: "2026-10-09T10:00:00Z", kind: "other" }],
      doctor: { at: "2026-10-09T10:00:00Z", items: [{ id: "a", level: "nope", title: "T", detail: "d", hint: "h" }] },
    });
    expect(s.version).toBe("0.4.0");
    expect(s).not.toHaveProperty("evil");
    expect(s.commit).toBeUndefined();
    expect(s.update_available).toBeUndefined();
    expect(s.behind_commits).toHaveLength(1);
    expect(s.behind_commits![0]!.subject.length).toBeLessThanOrEqual(100);
    expect(s.backups).toEqual([{ name: "a.db.gz", size: 5, at: "2026-10-09T10:00:00Z", kind: "manual" }]);
    expect(s.doctor!.items[0]!.level).toBe("warn");
  });
});

describe("ops: access", () => {
  it("every route refuses members (403) and anonymous (401)", async () => {
    const { member, client } = await setupApp();
    const eero = await member("eero");
    const anon = client();
    for (const [method, path, payload] of ROUTES) {
      expect((await eero.call(method, path, payload)).status, `member ${method} ${path}`).toBe(403);
      expect((await anon.call(method, path, payload)).status, `anonymous ${method} ${path}`).toBe(401);
    }
  });

  it("a member cannot queue anything, and nothing is written", async () => {
    const { member, s } = await setupApp();
    await helperOn(s);
    const eero = await member("eero");
    expect((await eero.call("POST", "/api/ops/request", { action: "restart" })).status).toBe(403);
    expect(await s.ops.recent(5)).toEqual([]);
  });

  it("state changes need the CSRF header, a same-site origin and a JSON body", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s);
    expect((await admin.call("POST", "/api/ops/request", { action: "doctor" }, { "X-Requested-With": "" })).status).toBe(403);
    expect((await admin.call("POST", "/api/ops/request", { action: "doctor" }, { Origin: "https://evil.example" })).status).toBe(403);
    const form = await admin.call("POST", "/api/ops/request", undefined, { "Content-Type": "application/x-www-form-urlencoded" });
    expect(form.status).toBe(415);
    expect((await admin.call("POST", "/api/ops/request", { action: "doctor" })).status).toBe(200);
  });

  it("answers with the content security policy and no-store", async () => {
    const { admin } = await setupApp();
    const r = await admin.call("GET", "/api/ops/state");
    expect(r.res.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(r.res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("ops: requests", () => {
  it("is refused with a clear message while the helper has never been seen, and audited", async () => {
    const { admin } = await setupApp();
    const state = (await admin.call("GET", "/api/ops/state")).body;
    expect(state.helper.status).toBe("off");
    expect(state.helper.enableCommand).toBe("./scripts/install.sh --ops-helper");
    const r = await admin.call("POST", "/api/ops/request", { action: "doctor" });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("Ylläpitoapuri");
    const audit = (await admin.call("GET", "/api/ops/audit")).body.events;
    expect(audit[0]).toMatchObject({ action: "järjestelmän tarkistus", outcome: "kielletty, apuri ei käytössä" });
  });

  it("update and rollback need the password again; a wrong one is 403, audited, and the 6th is 429", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s);
    expect((await admin.call("POST", "/api/ops/request", { action: "update" })).status).toBe(403);
    for (let i = 0; i < 5; i++) expect((await admin.call("POST", "/api/ops/request", { action: "update", password: "väärä" })).status).toBe(403);
    const sixth = await admin.call("POST", "/api/ops/request", { action: "update", password: "väärä" });
    expect(sixth.status).toBe(429);
    expect(sixth.res.headers.get("retry-after")).toBeTruthy();
    // even the right password waits out the lockout
    expect((await admin.call("POST", "/api/ops/request", { action: "update", password: PASSWORD })).status).toBe(429);
    const events = (await admin.call("GET", "/api/ops/audit")).body.events as { outcome: string }[];
    // the call without a password and the five wrong ones
    expect(events.filter((e) => e.outcome === "kielletty, salasana")).toHaveLength(6);
    expect(await s.ops.recent(5)).toEqual([]);
  });

  it("queues an update with the password, audits it and tells the other admins", async () => {
    const { admin, s, adminId } = await setupApp();
    await helperOn(s);
    const created = await admin.call("POST", "/api/users", { username: "kaisa", displayName: "Kaisa", role: "admin" });
    expect(created.status).toBe(201);
    const r = await admin.call("POST", "/api/ops/request", { action: "update", password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.request).toMatchObject({ action: "update", status: "queued", by: "aino" });
    expect(r.body.request.id).toMatch(/^op_[0-9a-f]{16}$/);
    expect(JSON.stringify(r.body)).not.toContain(PASSWORD);
    const audit = (await admin.call("GET", "/api/ops/audit")).body.events;
    expect(audit[0]).toMatchObject({ username: "aino", action: "päivitys", outcome: "jonossa" });
    // the notice goes to the other admin, not to the one who asked
    expect((await s.security.unseenNotices(adminId)).filter((e) => e.kind === "ops_notice")).toHaveLength(0);
    const kaisa = (await s.users.findForLogin("kaisa"))!;
    const notices = await s.security.unseenNotices(kaisa.id);
    expect(notices.map((e) => e.kind)).toEqual(["ops_notice"]);
    expect(notices[0]!.detail).toContain("Aino käynnisti toiminnon: päivitys");
  });

  it("rollback needs the word PALAUTA and a stored previous version", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s);
    const noWord = await admin.call("POST", "/api/ops/request", { action: "rollback", password: PASSWORD });
    expect(noWord.status).toBe(400);
    expect(noWord.body.error).toContain("PALAUTA");
    const nothing = await admin.call("POST", "/api/ops/request", { action: "rollback", password: PASSWORD, confirm: "PALAUTA" });
    expect(nothing.status).toBe(400);
    await cli(s, ["state"], JSON.stringify({ can_rollback: true }));
    expect((await admin.call("POST", "/api/ops/request", { action: "rollback", password: PASSWORD, confirm: "palauta" })).status).toBe(400);
    expect((await admin.call("POST", "/api/ops/request", { action: "rollback", password: PASSWORD, confirm: "PALAUTA" })).status).toBe(200);
  });

  it("backup, restart, doctor and check-update need no password", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s);
    expect((await admin.call("POST", "/api/ops/request", { action: "doctor" })).status).toBe(200);
    expect((await admin.call("POST", "/api/ops/request", { action: "check-update" })).status).toBe(200);
    expect((await admin.call("POST", "/api/ops/request", { action: "backup" })).status).toBe(200);
  });

  it("logs, prune and helper-renew go through the same flow: no password, the helper must be on, one mutating at a time", async () => {
    const { admin, s } = await setupApp();
    const off = await admin.call("POST", "/api/ops/request", { action: "logs" });
    expect(off.status).toBe(409);
    await helperOn(s);
    // logs only reads: it runs beside a mutating request and does not take the slot
    expect((await admin.call("POST", "/api/ops/request", { action: "prune" })).status).toBe(200);
    expect((await admin.call("POST", "/api/ops/request", { action: "logs" })).status).toBe(200);
    expect((await admin.call("POST", "/api/ops/request", { action: "helper-renew" })).status).toBe(409);
    expect((await admin.call("POST", "/api/ops/request", { action: "prune" })).status).toBe(409);
    const state = (await admin.call("GET", "/api/ops/state")).body;
    expect(state.requests.map((r: { label: string }) => r.label)).toEqual(["lokien luku", "levyn siivous"]);
    expect(state.requests.map((r: { action: string }) => r.action)).toEqual(["logs", "prune"]);
    // the helper gets them in order, with the usual exact shape
    expect(await cli(s, ["poll", "--helper", "2", "--done", ""])).toMatchObject({ request: { action: "prune", params: {}, secret: null } });
    const audit = (await admin.call("GET", "/api/ops/audit")).body.events as { action: string; outcome: string }[];
    expect(audit.filter((e) => e.outcome === "jonossa").map((e) => e.action)).toEqual(["lokien luku", "levyn siivous"]);
  });

  it("a version 1 helper does not know the new actions: refused up front, the old ones still work", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s, "1");
    for (const action of ["logs", "prune", "helper-renew"]) {
      const r = await admin.call("POST", "/api/ops/request", { action });
      expect(r.status, action).toBe(409);
      expect(r.body.error).toContain("./scripts/install.sh --ops-helper");
    }
    expect(await s.ops.recent(5)).toEqual([]);
    expect((await admin.call("GET", "/api/ops/state")).body.helper).toMatchObject({ tools: false, outdated: false });
    expect((await admin.call("POST", "/api/ops/request", { action: "doctor" })).status).toBe(200);
    await helperOn(s);
    expect((await admin.call("GET", "/api/ops/state")).body.helper.tools).toBe(true);
    expect((await admin.call("POST", "/api/ops/request", { action: "logs" })).status).toBe(200);
  });

  it("helper-renew follows a finished prune, and a stored row of each new action is accepted by the table", async () => {
    const { admin, s, adminId } = await setupApp();
    await helperOn(s);
    for (const action of ["logs", "prune", "helper-renew"]) {
      const id = (await admin.call("POST", "/api/ops/request", { action })).body.request.id;
      await cli(s, ["poll", "--helper", "2"]);
      await cli(s, ["report"], JSON.stringify({ id, status: "ok", exit_code: 0, summary: "Valmis.", output: "x" }));
      expect((await s.ops.get(id))!.status).toBe("ok");
      s.opsLimiter.reset(`ops:${adminId}`);
      await s.db.run("UPDATE ops_requests SET requested_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [id]);
    }
  });

  it("the logs report keeps 300 lines and hides tokens; other actions keep the last 200", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s);
    const logs = Array.from({ length: 300 }, (_, i) => `banking-1  | line ${i}`).concat(["banking-1  | call with Bearer abc123 and eyJhbGciOiJSUzI1NiJ9.eyJ4IjoxfQ.sig"]).join("\n");
    const id = (await admin.call("POST", "/api/ops/request", { action: "logs" })).body.request.id;
    await cli(s, ["poll", "--helper", "2"]);
    await cli(s, ["report"], JSON.stringify({ id, status: "ok", exit_code: 0, summary: "Lokit luettu.", output: logs }));
    const row = (await s.ops.get(id))!;
    expect(row.output!.split("\n")).toHaveLength(301);
    expect(row.output).not.toMatch(/abc123|eyJ/);
    const id2 = (await admin.call("POST", "/api/ops/request", { action: "prune" })).body.request.id;
    await cli(s, ["poll", "--helper", "2"]);
    await cli(s, ["report"], JSON.stringify({ id: id2, status: "ok", exit_code: 0, summary: "Valmis.", output: logs }));
    expect((await s.ops.get(id2))!.output!.split("\n")).toHaveLength(200);
  });

  it("one mutating request at a time (409); read-only ones run beside it", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s);
    expect((await admin.call("POST", "/api/ops/request", { action: "restart" })).status).toBe(200);
    const second = await admin.call("POST", "/api/ops/request", { action: "backup" });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("Toinen toiminto on kesken.");
    expect((await admin.call("POST", "/api/ops/request", { action: "doctor" })).status).toBe(200);
    // the unique index backs this up when two requests race
    expect(await s.ops.insert({ id: "op_aaaaaaaaaaaaaaaa", action: "backup", requestedBy: "x", at: NOW.toISOString() })).toBe(false);
  });

  it("a queued request can be cancelled, a running one cannot", async () => {
    const t = clock();
    const { admin, s } = await setupApp({}, undefined, { now: t.now });
    await helperOn(s);
    const id = (await admin.call("POST", "/api/ops/request", { action: "restart" })).body.request.id;
    expect((await admin.call("POST", "/api/ops/cancel/not-an-id", {})).status).toBe(400);
    expect((await admin.call("POST", `/api/ops/cancel/${id}`, {})).status).toBe(200);
    expect((await s.ops.get(id))!.status).toBe("cancelled");
    t.advance(61_000);
    await helperOn(s);
    const id2 = (await admin.call("POST", "/api/ops/request", { action: "backup" })).body.request.id;
    await cli(s, ["poll", "--helper", "1"]);
    expect((await admin.call("POST", `/api/ops/cancel/${id2}`, {})).status).toBe(400);
  });

  it("rate limits: one mutating request a minute, 20 requests an hour", async () => {
    const t = clock();
    const { admin, s } = await setupApp({}, undefined, { now: t.now });
    await helperOn(s);
    const first = (await admin.call("POST", "/api/ops/request", { action: "restart" })).body.request.id;
    await cli(s, ["poll", "--helper", "1"]);
    await cli(s, ["report"], JSON.stringify({ id: first, status: "ok", exit_code: 0 }));
    t.advance(30_000);
    await helperOn(s);
    const quick = await admin.call("POST", "/api/ops/request", { action: "restart" });
    expect(quick.status).toBe(429);
    expect(quick.res.headers.get("retry-after")).toBe("60");
    t.advance(31_000);
    await helperOn(s);
    expect((await admin.call("POST", "/api/ops/request", { action: "restart" })).status).toBe(200);
    // fill the hour with read-only requests
    let n = 2;
    for (; n < 20; n++) {
      await helperOn(s);
      expect((await admin.call("POST", "/api/ops/request", { action: "doctor" })).status, `request ${n + 1}`).toBe(200);
    }
    const over = await admin.call("POST", "/api/ops/request", { action: "doctor" });
    expect(over.status).toBe(429);
    t.advance(3600_000);
    await helperOn(s);
    expect((await admin.call("POST", "/api/ops/request", { action: "doctor" })).status).toBe(200);
  });

  it("buttons stay off when the helper has been silent for a day, and requests expire after 10 minutes", async () => {
    const t = clock();
    const { admin, s } = await setupApp({}, undefined, { now: t.now });
    await helperOn(s);
    t.advance(4 * 60_000);
    expect((await admin.call("GET", "/api/ops/state")).body.helper.status).toBe("slow");
    const id = (await admin.call("POST", "/api/ops/request", { action: "restart" })).body.request.id;
    t.advance(11 * 60_000);
    const state = (await admin.call("GET", "/api/ops/state")).body;
    expect(state.requests[0]).toMatchObject({ id, status: "expired", summary: "Apuri ei ottanut pyyntöä vastaan." });
    expect(state.active).toBe(false);
    t.advance(25 * 3600_000);
    const r = await admin.call("POST", "/api/ops/request", { action: "restart" });
    expect(r.status).toBe(409);
  });
});

describe("ops: the helper's CLI", () => {
  it("poll hands out the oldest queued request once, with the exact shape, and marks it running", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s);
    expect(await cli(s, ["poll", "--helper", "1"])).toEqual({ request: null });
    const id = (await admin.call("POST", "/api/ops/request", { action: "check-update" })).body.request.id;
    const polled = await cli(s, ["poll", "--helper", "1", "--done", ""]);
    expect(polled).toEqual({ request: { id, action: "check-update", params: {}, secret: null } });
    expect((await s.ops.get(id))!.status).toBe("running");
    expect(await cli(s, ["poll", "--helper", "1"])).toEqual({ request: null });
    expect(await s.settings.get("ops_helper_version")).toBe("1");
  });

  it("a restored database does not bring a handled request back to life", async () => {
    const t = clock();
    const { admin, s } = await setupApp({}, undefined, { now: t.now });
    await helperOn(s);
    const id = (await admin.call("POST", "/api/ops/request", { action: "restart" })).body.request.id;
    expect(await cli(s, ["poll", "--helper", "1", "--done", `${id},garbage,../x`])).toEqual({ request: null });
    const row = (await s.ops.get(id))!;
    expect(row.status).toBe("failed");
    // and it no longer blocks the next one
    t.advance(61_000);
    await helperOn(s);
    expect((await admin.call("POST", "/api/ops/request", { action: "backup" })).status).toBe(200);
  });

  it("refuses a row that is not one of the allowed shapes", async () => {
    const { s, adminId } = await setupApp();
    await helperOn(s);
    await s.db.run("INSERT INTO ops_requests (id, action, params, requested_by, requested_at) VALUES ('op_0000000000000001','access','{\"mode\":\"lan\"}',?,?)", [adminId, NOW.toISOString()]);
    expect(await cli(s, ["poll", "--helper", "1"])).toEqual({ request: null });
    expect((await s.ops.get("op_0000000000000001"))!.summary).toBe("Virheellinen pyyntö.");
    await s.db.run("INSERT INTO ops_requests (id, action, params, requested_by, requested_at) VALUES ('op_0000000000000002','restart','{\"x\":1}',?,?)", [adminId, NOW.toISOString()]);
    expect(await cli(s, ["poll", "--helper", "1"])).toEqual({ request: null });
    expect((await s.ops.get("op_0000000000000002"))!.status).toBe("failed");
  });

  it("report stores a scrubbed result, is idempotent and updates the state", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s);
    const id = (await admin.call("POST", "/api/ops/request", { action: "restart" })).body.request.id;
    await cli(s, ["poll", "--helper", "1"]);
    const payload = JSON.stringify({
      id,
      status: "ok",
      exit_code: 0,
      summary: `Valmis ${"B".repeat(60)}`,
      output: `STEP: 1/2 Haku\nSTEP: 2/2 Käynnistys\nTUNNEL_TOKEN=secretvalue\n${XSS[0]}`,
      state: { version: "0.4.0", update_available: true, behind_commits: [{ hash: "abc1234", subject: XSS[1] }], can_rollback: true },
    });
    expect(await cli(s, ["report"], payload)).toEqual({ ok: true });
    const first = (await s.ops.get(id))!;
    expect(first).toMatchObject({ status: "ok", exitCode: 0 });
    expect(first.output).not.toContain("secretvalue");
    expect(first.summary).not.toContain("BBBBBBBB");
    expect(JSON.parse(first.steps!)).toHaveLength(2);
    // a second report changes nothing
    await cli(s, ["report"], JSON.stringify({ id, status: "failed", exit_code: 1, summary: "Muu", output: "x" }));
    expect(await s.ops.get(id)).toMatchObject({ status: "ok", summary: first.summary, output: first.output });
    const state = (await admin.call("GET", "/api/ops/state")).body;
    expect(state.state).toMatchObject({ version: "0.4.0", update_available: true, can_rollback: true });
    // the audit list shows the end
    expect((await admin.call("GET", "/api/ops/audit")).body.events[0]).toMatchObject({ action: "uudelleenkäynnistys", outcome: "valmis" });
  });

  it("XSS strings come back verbatim as JSON text (the page renders them as text)", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s);
    const id = (await admin.call("POST", "/api/ops/request", { action: "restart" })).body.request.id;
    await cli(s, ["poll"]);
    await cli(s, ["report"], JSON.stringify({ id, status: "failed", exit_code: 1, summary: XSS[1], output: XSS.join("\n"), state: { behind_commits: [{ hash: "abc1234", subject: XSS[3] }] } }));
    const state = (await admin.call("GET", "/api/ops/state")).body;
    expect(state.requests[0].output).toBe(XSS.join("\n"));
    expect(state.requests[0].summary).toBe(XSS[1]);
    expect(state.state.behind_commits[0].subject).toBe(XSS[3]);
    expect(state.requests[0].output).toContain("<script>");
  });

  it("a late report still ends a request the app had given up on", async () => {
    const t = clock();
    const { admin, s } = await setupApp({}, undefined, { now: t.now });
    await helperOn(s);
    const id = (await admin.call("POST", "/api/ops/request", { action: "restart" })).body.request.id;
    await cli(s, ["poll", "--helper", "1"]);
    t.advance(31 * 60_000);
    await helperOn(s);
    expect((await admin.call("GET", "/api/ops/state")).body.requests[0]).toMatchObject({ status: "failed", summary: "Ei vastausta." });
    await cli(s, ["report"], JSON.stringify({ id, status: "ok", exit_code: 0, summary: "Valmis", output: "x" }));
    expect((await s.ops.get(id))!.status).toBe("ok");
  });

  it("bad input is reported in the JSON, never as a crash or a stack trace", async () => {
    const { s } = await setupApp();
    expect(await cli(s, ["report"], "not json")).toMatchObject({ ok: false });
    expect(await cli(s, ["report"], JSON.stringify({ id: "op_../../x", status: "ok" }))).toMatchObject({ ok: false });
    expect(await cli(s, ["report"], JSON.stringify({ id: "op_0123456789abcdef", status: "ok", cmd: "id" }))).toMatchObject({ ok: false });
    expect(await cli(s, ["report"], JSON.stringify({ id: "op_0123456789abcdef", status: "ok" }))).toEqual({ ok: true });
  });
});

function names(file: string): string[] {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    return (d.prepare("SELECT username FROM users").all() as { username: string }[]).map((r) => r.username);
  } finally {
    d.close();
  }
}

describe("ops: backup download", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  /** Real database copies (a download is checked before it leaves); a body that is not a .db name stays text. */
  async function backups(files: Record<string, { body: string; age: number }>) {
    const dir = mkdtempSync(join(tmpdir(), "talous-ops-"));
    dirs.push(dir);
    const { db } = await openDatabase(join(dir, "template.db"));
    for (const [name, f] of Object.entries(files)) {
      if (name.endsWith(".db")) {
        db.exec(`DELETE FROM users; INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u', '${f.body}', 'X', 'h', 'admin', '2026-01-01')`);
        db.exec(`VACUUM INTO '${join(dir, name)}'`);
      } else writeFileSync(join(dir, name), f.body);
      const t = new Date(NOW.getTime() - f.age);
      utimesSync(join(dir, name), t, t);
    }
    db.close();
    for (const f of readdirSync(dir)) if (f.startsWith("template.db")) rmSync(join(dir, f));
    return dir;
  }

  it("streams the newest copy to an admin who gives the password, and audits it", async () => {
    const dir = await backups({ "auto-2026-10-08.db": { body: "old", age: 86_400_000 }, "pre-update-20261009T090000.db": { body: "newest-copy", age: 3600_000 }, "notes.txt": { body: "no", age: 0 } });
    const { admin, member, s } = await setupApp({}, undefined, { backupDir: dir });
    const kaisa = await admin.call("POST", "/api/users", { username: "kaisa", displayName: "Kaisa", role: "admin" });
    expect(kaisa.status).toBe(201);
    const state = (await admin.call("GET", "/api/ops/state")).body;
    expect(state.appBackups.map((b: { name: string }) => b.name)).toEqual(["pre-update-20261009T090000.db", "auto-2026-10-08.db"]);
    expect((await admin.call("POST", "/api/ops/backups/latest", {})).status).toBe(403);
    expect((await admin.call("POST", "/api/ops/backups/latest", { password: "väärä" })).status).toBe(403);
    const ok = await admin.call("POST", "/api/ops/backups/latest", { password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(Number(ok.res.headers.get("content-length"))).toBe(statSync(join(dir, "pre-update-20261009T090000.db")).size);
    expect(names(join(dir, "pre-update-20261009T090000.db"))).toEqual(["newest-copy"]);
    expect(ok.res.headers.get("content-disposition")).toBe('attachment; filename="pre-update-20261009T090000.db"');
    expect(ok.res.headers.get("cache-control")).toBe("no-store");
    expect((await admin.call("GET", "/api/ops/audit")).body.events[0]).toMatchObject({ action: "varmuuskopion lataus", outcome: expect.stringContaining("ladattu") });
    const eero = await member("eero");
    expect((await eero.call("POST", "/api/ops/backups/latest", { password: "eero-uusi-salasana" })).status).toBe(403);
    const k = (await s.users.findForLogin("kaisa"))!;
    expect((await s.security.unseenNotices(k.id)).some((e) => e.kind === "ops_notice")).toBe(true);
  });

  it("allows five downloads an hour, and says so when there is no copy", async () => {
    const empty = await backups({});
    const a = await setupApp({}, undefined, { backupDir: empty });
    const none = await a.admin.call("POST", "/api/ops/backups/latest", { password: PASSWORD });
    expect(none.status).toBe(400);
    expect(none.body.error).toContain("Varmuuskopiota ei ole");
    const dir = await backups({ "auto-2026-10-09.db": { body: "x", age: 0 } });
    const { admin } = await setupApp({}, undefined, { backupDir: dir });
    for (let i = 0; i < 5; i++) expect((await admin.call("POST", "/api/ops/backups/latest", { password: PASSWORD })).status).toBe(200);
    expect((await admin.call("POST", "/api/ops/backups/latest", { password: PASSWORD })).status).toBe(429);
  });
});
