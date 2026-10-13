/** POST /api/ops/reset (services/reset.ts): the household's data goes, the admin's account and the install stay. */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECKED } from "../src/connectors/enable-banking/app-setup.ts";
import { enableBanking } from "../src/connectors/enable-banking/index.ts";
import { verifyDatabaseFile } from "../src/db/backup-check.ts";
import { openDatabase } from "../src/db/open.ts";
import { restoreDatabase } from "../src/db/restore.ts";
import { restoreRequestPath } from "../src/db/startup-gate.ts";
import type { Db } from "../src/db/types.ts";
import { inflightCount, track } from "../src/platform/inflight.ts";
import { listAppBackups } from "../src/services/ops.ts";
import { dangerUnderWay } from "../src/services/ops-danger.ts";
import { resetData } from "../src/services/reset.ts";
import { seedCsv } from "./csv-seed.ts";
import { mockBank } from "./mock-bank.ts";
import { scratchDir, setupApp, waitFor } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const APP_SECRET = "test-secret-that-is-long-enough-0123456789";
const PASSWORD = "aino-salasana-123";
const WORD = "TYHJENNÄ";
const MARK = "MERKKIKAUPPA-7F3A91";

const dirs: string[] = [];
const open: { close(): void }[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const db of open.splice(0)) {
    try {
      db.close();
    } catch {
      // closed by the test
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const callback = (state: string) => ({ url: `https://x.example/cb?code=abc&state=${state}` });

/** Every table with a user_id column, read from the schema: a table added later is covered without a change here. */
async function userTables(db: Db): Promise<string[]> {
  const names = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((t) => t.name);
  const out: string[] = [];
  for (const name of names) {
    if ((await db.all<{ name: string }>(`PRAGMA table_info("${name}")`)).some((c) => c.name === "user_id")) out.push(name);
  }
  return out;
}

/** The rows of every table that holds household data, in a fixed order. */
async function dump(db: Db): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of ["users", "settings", ...(await userTables(db))]) {
    out[table] = (await db.all<Record<string, unknown>>(`SELECT * FROM "${table}"`)).map((r) => JSON.stringify(r)).sort();
  }
  return out;
}

/** A household on a database file: the admin Aino, a second admin Eero and the member Liisa, each with rows, two with a bank consent (or none). */
async function household(consent = true) {
  const dir = scratchDir("talous-reset-");
  dirs.push(dir);
  const dbPath = join(dir, "banking.db");
  const { db } = await openDatabase(dbPath);
  open.push(db);
  const bank = mockBank();
  const t = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock, { db, backupDir: join(dir, "backups") });
  const eero = await t.member("eero", "Eero");
  await t.s.users.update(eero.id, { role: "admin" });
  const liisa = await t.member("liisa", "Liisa");
  const csv = (who: string) => `Kirjauspäivä;Määrä;Nimi\n2026-09-01;-12,50;${MARK} ${who}\n2026-09-02;-40,00;Ruokakauppa\n`;
  for (const who of [t.admin, eero, liisa]) expect((await seedCsv(t.s, who, { content: csv("x"), accountName: "Tili" })).status).toBe(200);
  for (const who of consent ? [t.admin, liisa] : []) {
    await who.call("POST", "/api/connections/start", {});
    expect((await who.call("POST", "/api/connections/complete", callback(bank.state))).status).toBe(200);
  }
  const consents = [...(await t.s.finance(t.adminId).listConnections()), ...(await t.s.finance(liisa.id).listConnections())].map((c) => c.id);
  expect(consents.length).toBe(consent ? 2 : 0);
  // the first fetch after a consent runs in the background
  await waitFor(async () => inflightCount() === 0);
  // an event without a user that names a member, as removing a member leaves one
  const gone = await t.member("vanha");
  expect((await t.admin.call("DELETE", `/api/users/${gone.id}`)).status).toBe(200);
  return { ...t, db: t.s.db, dir, dbPath, bank, eero, liisa, consents };
}

const reset = (c: { call: Awaited<ReturnType<typeof setupApp>>["admin"]["call"] }, payload: unknown = { password: PASSWORD, confirm: WORD }) => c.call("POST", "/api/ops/reset", payload);

describe("the reset from the browser", () => {
  it("empties every table of the household and keeps the admin, the settings and a checked copy", async () => {
    const h = await household();
    const tables = await userTables(h.db);
    for (const must of ["accounts", "transactions", "connections", "sessions", "security_events", "bank_credentials", "sync_runs"]) expect(tables).toContain(must);
    const filled: string[] = [];
    for (const table of tables) if ((await h.db.first<{ c: number }>(`SELECT COUNT(*) AS c FROM "${table}"`))!.c > 0) filled.push(table);
    for (const must of ["accounts", "transactions", "connections", "sessions", "security_events"]) expect(filled).toContain(must);

    const ids = (await h.s.users.list()).map((u) => u.id);
    expect(ids.length).toBe(3);
    const adminRow = await h.db.first<Record<string, unknown>>("SELECT * FROM users WHERE id = ?", [h.adminId]);
    // rows of the instance: what the shared bank application's check left, and a setting of the server
    await h.s.settings.set(CHECKED, JSON.stringify({ appId: "sovellus-1", active: true, checkedAt: "2026-10-01T00:00:00.000Z" }));
    await h.s.settings.set("instance_asetus", "säilyy");
    const settingsBefore = await h.db.all<{ key: string; value: string }>("SELECT key, value FROM settings ORDER BY key");
    const instanceBefore = settingsBefore.filter((r) => r.key !== "data_version" && !ids.some((id) => r.key.includes(id)));
    expect(settingsBefore.some((r) => ids.some((id) => r.key.includes(id)))).toBe(true);
    expect(instanceBefore.map((r) => r.key)).toEqual(expect.arrayContaining([CHECKED, "instance_asetus"]));
    // the register cache: a company it found, and two payees it did not, one of them a private person
    await h.db.run("DELETE FROM merchant_industry");
    await h.db.run("INSERT INTO merchant_industry (merchant, status, business_id, company_name, checked_at) VALUES ('ruokakauppa oy', 'found', '1234567-8', 'Ruokakauppa Oy', '2026-10-01T00:00:00.000Z')");
    await h.db.run("INSERT INTO merchant_industry (merchant, status, checked_at) VALUES ('matti meikäläinen', 'none', '2026-10-01T00:00:00.000Z'), ('kioski', 'ambiguous', '2026-10-01T00:00:00.000Z')");
    await h.s.ops.insert({ id: "op_done", action: "backup", requestedBy: h.eero.id, at: "2026-10-01T00:00:00.000Z" });
    await h.db.run("UPDATE ops_requests SET status = 'ok' WHERE id = 'op_done'");
    expect((await h.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM security_events WHERE user_id IS NULL AND kind = 'user_deleted'"))!.c).toBe(1);

    const r = await reset(h.admin);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, copy: "pre-reset-20261009T100000.db", revoked: 2, failed: 0, message: "Tiedot on tyhjennetty. Kirjaudu sisään uudelleen." });
    // the browser is told to drop its cookie
    expect(h.admin.cookie).toBe("");

    // every user table is empty, but for the one event of the reset
    for (const table of tables) {
      const rows = await h.db.all<Record<string, unknown>>(`SELECT * FROM "${table}"`);
      if (table === "security_events") {
        expect(rows.map((e) => [e.kind, e.user_id])).toEqual([["data_reset", h.adminId]]);
        expect(rows[0]!.detail).toBe("varmuuskopio pre-reset-20261009T100000.db, pankkiyhteyksiä lopetettu 2, lopettamatta jäi 0");
      } else expect(rows, table).toEqual([]);
    }
    // the admin's row is the same row
    expect(await h.db.all("SELECT * FROM users")).toEqual([adminRow]);
    // settings: no row of one user is left, the instance rows are as they were, the data version moved on
    const settingsAfter = await h.db.all<{ key: string; value: string }>("SELECT key, value FROM settings ORDER BY key");
    expect(settingsAfter.filter((row) => ids.some((id) => row.key.includes(id)))).toEqual([]);
    expect(settingsAfter.filter((row) => row.key !== "data_version")).toEqual(instanceBefore);
    const version = (rows: typeof settingsAfter) => Number(rows.find((row) => row.key === "data_version")?.value ?? 0);
    expect(version(settingsAfter)).toBeGreaterThan(version(settingsBefore));
    // kept: what the register says of a company, and the maintenance rows. A payee it did not know is gone, in the file too.
    expect((await h.db.all<{ merchant: string }>("SELECT merchant FROM merchant_industry")).map((m) => m.merchant)).toEqual(["ruokakauppa oy"]);
    expect(readFileSync(h.dbPath).includes("matti meikäläinen")).toBe(false);
    expect((await h.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM ops_requests"))!.c).toBe(1);

    // the consents were ended at the bank, each through its own member's key
    for (const id of h.consents) expect(h.bank.calls).toContain(`DELETE /sessions/${id}`);

    // the copy is whole and holds the household; the live file and its log no longer hold a member's row
    const copy = join(h.dir, "backups", r.body.copy);
    expect(verifyDatabaseFile(copy)).toMatchObject({ ok: true, users: 3 });
    expect(readFileSync(copy).includes(MARK)).toBe(true);
    expect(readFileSync(h.dbPath).includes(MARK)).toBe(false);
    expect(existsSync(`${h.dbPath}-wal`) && readFileSync(`${h.dbPath}-wal`).includes(MARK)).toBe(false);

    // every session is gone: the second admin's, the member's and the asker's own
    for (const who of [h.eero, h.liisa]) expect((await who.call("GET", "/api/meta")).status).toBe(401);
    expect((await h.admin.call("GET", "/api/meta")).status).toBe(401);
    expect((await h.client().call("POST", "/api/auth/login", { username: "eero", password: "eero-uusi-salasana" })).status).not.toBe(200);

    // the admin signs in with the old password and is the same admin, with nothing in the accounts
    const again = h.client();
    const login = await again.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ id: h.adminId, username: "aino", role: "admin" });
    expect((await again.call("GET", "/api/users")).body.users.map((u: { username: string }) => u.username)).toEqual(["aino"]);
    expect((await h.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM transactions"))!.c).toBe(0);
  });

  it("goes on when the bank refuses or the revoke itself breaks, and names it in the answer and the event", async () => {
    const h = await household();
    h.bank.status = 401;
    const r = await reset(h.admin);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, revoked: 0, failed: 2 });
    expect((await h.s.users.list()).map((u) => u.id)).toEqual([h.adminId]);
    expect((await h.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM connections"))!.c).toBe(0);
    expect((await h.s.security.list({ kind: "data_reset", limit: 5 })).map((e) => e.detail)).toEqual(["varmuuskopio pre-reset-20261009T100000.db, pankkiyhteyksiä lopetettu 0, lopettamatta jäi 2"]);

    // a connector that throws instead of counting
    const h2 = await household();
    vi.spyOn(enableBanking, "revokeAll").mockRejectedValue(new Error("Authorization: Bearer salainen-tunniste"));
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(" ")));
    const r2 = await reset(h2.admin);
    expect(r2.status).toBe(200);
    // the log names the kind of error, never its words
    expect(errors.length).toBe(3);
    expect(errors.join("\n")).not.toContain("salainen-tunniste");
    expect(JSON.stringify(await h2.db.all("SELECT * FROM security_events"))).not.toContain("salainen-tunniste");
    expect(r2.body).toMatchObject({ ok: true, revoked: 0, failed: 3 });
    expect((await h2.s.users.list()).length).toBe(1);
    expect((await h2.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM accounts"))!.c).toBe(0);
  });

  it("writes no secret to the log, the events or the answer", async () => {
    const h = await household();
    const lines: string[] = [];
    for (const level of ["log", "error", "warn", "info"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    // one consent is refused by the bank, with a token in the bank's words
    h.bank.answers[`DELETE /sessions/${h.consents[0]}`] = { status: 500, body: { error: "Bearer vuotava-tunniste" } };
    const hash = (await h.s.users.findForLogin("aino"))!.passwordHash;
    const sealed = (await h.s.users.allBankCredentials()).map((c) => c.privateKeyEnc);
    const r = await reset(h.admin);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ revoked: 1, failed: 1 });
    expect(lines.some((l) => l.startsWith("data reset: done"))).toBe(true);

    const told = [JSON.stringify(r.body), lines.join("\n"), JSON.stringify(await h.db.all("SELECT * FROM security_events"))].join("\n");
    const keyLines = pem.split("\n").filter((l) => l.length > 40);
    for (const secret of [APP_SECRET, PASSWORD, hash, ...sealed, ...keyLines, ...h.bank.tokens, "vuotava-tunniste", "BEGIN PRIVATE KEY"]) {
      expect(secret.length).toBeGreaterThan(8);
      expect(told.includes(secret), secret.slice(0, 12)).toBe(false);
    }
    expect(h.bank.tokens.length).toBeGreaterThan(0);
  });

  it("changes nothing when the copy cannot be made", async () => {
    const h = await household();
    // a file where the folder of the copies should be
    writeFileSync(join(h.dir, "backups"), "ei kansio");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = await dump(h.db);
    const calls = h.bank.calls.length;
    const r = await reset(h.admin);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("Varmuuskopion teko epäonnistui, joten mitään ei tyhjennetty.");
    expect(h.bank.calls.length).toBe(calls);
    const after = await dump(h.db);
    // the refusal is written down, and that is all
    expect(after.security_events!.length).toBe(before.security_events!.length + 1);
    expect((await h.s.security.list({ kind: "ops_denied", limit: 1 }))[0]!.detail).toBe("tietojen tyhjennys: varmuuskopio epäonnistui");
    expect({ ...after, security_events: [] }).toEqual({ ...before, security_events: [] });
    for (const who of [h.admin, h.eero, h.liisa]) expect((await who.call("GET", "/api/meta")).status).toBe(200);

    // a database in memory has no file to copy
    const memory = await setupApp();
    const m = await reset(memory.admin);
    expect(m.status).toBe(503);
    expect(await memory.s.users.count()).toBe(1);
    expect((await memory.admin.call("GET", "/api/meta")).status).toBe(200);
  });

  it("is for an admin who gives the password and the word, as JSON", async () => {
    const h = await household();
    const before = await dump(h.db);
    const untouched = async () => {
      const now = await dump(h.db);
      expect({ ...now, security_events: [] }).toEqual({ ...before, security_events: [] });
      expect(existsSync(join(h.dir, "backups"))).toBe(false);
    };

    expect((await reset(h.liisa, { password: "liisa-uusi-salasana", confirm: WORD })).status).toBe(403);
    expect((await reset(h.client())).status).toBe(401);
    for (const confirm of ["tyhjennä", "TYHJENNA", "", undefined, 1]) {
      const r = await reset(h.admin, { password: PASSWORD, confirm });
      expect(r.status, String(confirm)).toBe(400);
      expect(r.body.error).toBe("Kirjoita TYHJENNÄ vahvistukseksi.");
    }
    // a refused attempt is in the audit list, as it is for the update and the restore
    expect((await h.s.security.list({ kind: "ops_denied", limit: 10 })).map((e) => e.detail)).toEqual(Array(5).fill("tietojen tyhjennys: vahvistus"));
    expect((await reset(h.admin, { password: PASSWORD, confirm: WORD, all: true })).status).toBe(400);
    expect((await reset(h.admin, [PASSWORD, WORD])).status).toBe(400);
    for (const password of ["väärä-salasana-1", "", undefined, 5]) expect((await reset(h.admin, { password, confirm: WORD })).status, String(password)).toBe(403);
    expect((await h.s.security.list({ kind: "ops_denied", limit: 1 }))[0]!.detail).toBe("tietojen tyhjennys: salasana");
    // a form post is refused before anything is read
    expect((await h.admin.call("POST", "/api/ops/reset", { password: PASSWORD, confirm: WORD }, { "Content-Type": "text/plain" })).status).toBe(415);
    // the other admin's password is not this admin's
    expect((await reset(h.admin, { password: "eero-uusi-salasana", confirm: WORD })).status).toBe(403);
    await untouched();
    expect(h.bank.calls.some((c) => c.startsWith("DELETE "))).toBe(false);
  });

  it("answers 409 while maintenance runs or a restore waits for the start", async () => {
    const h = await household();
    const before = await dump(h.db);
    await h.s.ops.insert({ id: "op_running", action: "update", requestedBy: h.adminId, at: "2026-10-09T09:59:00.000Z" });
    const busy = await reset(h.admin);
    expect(busy.status).toBe(409);
    expect(busy.body.error).toBe("Toinen toiminto on kesken.");
    await h.db.run("DELETE FROM ops_requests");

    writeFileSync(restoreRequestPath(h.dir), "auto-2026-10-08.db");
    const waits = await reset(h.admin);
    expect(waits.status).toBe(409);
    expect(waits.body.error).toBe("Toinen toiminto on kesken.");
    // refused before the password is read: a wrong one gets the same answer
    expect((await reset(h.admin, { password: "väärä-salasana-1", confirm: WORD })).body.error).toBe("Toinen toiminto on kesken.");
    expect({ ...(await dump(h.db)), security_events: [] }).toEqual({ ...before, security_events: [] });
    expect(existsSync(join(h.dir, "backups"))).toBe(false);
    expect((await h.s.security.list({ kind: "ops_denied", limit: 5 })).map((e) => e.detail)).toEqual(Array(3).fill("tietojen tyhjennys: toinen kesken"));

    rmSync(restoreRequestPath(h.dir));

    // a fetch in flight would write after the copy
    let finish!: () => void;
    void track(new Promise<void>((done) => (finish = done)));
    const fetching = await reset(h.admin);
    expect(fetching.status).toBe(409);
    expect(fetching.body.error).toBe("Tietojen haku on kesken. Yritä hetken päästä uudelleen.");
    finish();
    await waitFor(async () => inflightCount() === 0);

    // a copy of the same second is never written over
    const earlier = join(h.dir, "backups", "pre-reset-20261009T100000.db");
    mkdirSync(join(h.dir, "backups"));
    writeFileSync(earlier, "aiempi varmuuskopio");
    const same = await reset(h.admin);
    expect(same.status).toBe(409);
    expect(same.body.error).toBe("Samalla hetkellä tehty varmuuskopio on jo olemassa. Yritä hetken päästä uudelleen.");
    expect(readFileSync(earlier, "utf8")).toBe("aiempi varmuuskopio");
    expect({ ...(await dump(h.db)), security_events: [] }).toEqual({ ...before, security_events: [] });
    rmSync(join(h.dir, "backups"), { recursive: true });

    // a request that only reads does not hold it back
    await h.s.ops.insert({ id: "op_logs", action: "logs", requestedBy: h.adminId, at: "2026-10-09T09:59:30.000Z" });
    expect((await reset(h.admin)).status).toBe(200);
  });

  it("refuses a restore while the reset waits for the bank, and then ends whole", async () => {
    const h = await household();
    // the bank answers nothing until the test lets it fail
    let release!: () => void;
    const held = new Promise<never>((_, reject) => (release = () => reject(new Error("pankki ei vastaa"))));
    const revoke = vi.spyOn(enableBanking, "revokeAll").mockImplementation(() => held);
    vi.spyOn(console, "error").mockImplementation(() => {});
    // a restore that got through would stop the process 100 ms after its answer: the timers are fake from the first
    // request that could ask for it, and the clock is moved on at the end instead of waiting for it
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

    const resetting = reset(h.admin);
    await waitFor(async () => revoke.mock.calls.length > 0);
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    expect(dangerUnderWay(h.s)).toBe("reset");
    // the copy is written and intact: without the refusal the restore would take it and stop the server under the reset
    expect(listAppBackups(h.s).map((b) => [b.name, b.kind])).toEqual([["pre-reset-20261009T100000.db", "pre-reset"]]);
    expect((await h.admin.call("GET", "/api/ops/restore-latest")).body).toMatchObject({ copy: { name: "pre-reset-20261009T100000.db", kind: "pre-reset" }, pending: false });

    const restore = await h.admin.call("POST", "/api/ops/restore-latest", { password: PASSWORD, confirm: "PALAUTA" });
    expect(restore.status).toBe(409);
    expect(restore.body.error).toBe("Toinen toiminto on kesken.");
    expect(existsSync(restoreRequestPath(h.dir))).toBe(false);
    expect((await h.s.security.list({ kind: "ops_denied", limit: 5 })).map((e) => e.detail)).toEqual(["tietokannan palautus: toinen kesken"]);

    release();
    const r = await resetting;
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, copy: "pre-reset-20261009T100000.db", revoked: 0 });
    expect((await h.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM transactions"))!.c).toBe(0);
    expect(dangerUnderWay(h.s)).toBe(null);
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(kill).not.toHaveBeenCalled();
  });

  it("answers one of two requests sent at once, and the copy holds the household", async () => {
    const h = await household(false);
    const session = (await h.db.first<{ id: string }>("SELECT id FROM sessions WHERE user_id = ?", [h.adminId]))!.id;
    const asker = (await h.s.users.get(h.adminId))!;
    // the first reset is held at the bank, after the copy and before anything is emptied, until the other has its answer
    let release!: () => void;
    const held = new Promise<{ revoked: number; failed: number }>((done) => (release = () => done({ revoked: 0, failed: 0 })));
    const revoke = vi.spyOn(enableBanking, "revokeAll").mockImplementation(() => held);
    const sent = [reset(h.admin), reset(h.admin)];
    await waitFor(async () => revoke.mock.calls.length > 0);
    // only the one that is not held can answer now
    const answered = await Promise.race(sent.map((p, i) => p.then((r) => ({ i, r }))));
    release();
    const both = answered.i === 0 ? [answered.r, await sent[1]!] : [await sent[0]!, answered.r];
    expect(answered.r.status).toBe(409);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)!.body.error).toBe("Toinen toiminto on kesken.");
    const whole = () => {
      expect(readdirSync(join(h.dir, "backups"))).toEqual(["pre-reset-20261009T100000.db"]);
      const copy = join(h.dir, "backups", "pre-reset-20261009T100000.db");
      expect(verifyDatabaseFile(copy)).toMatchObject({ ok: true, users: 3 });
      expect(readFileSync(copy).includes(MARK)).toBe(true);
    };
    whole();
    expect(await h.s.users.count()).toBe(1);

    // a request that passed the sign-in check before the first reset ended, and runs after it: its session is gone
    const late = resetData(h.s, asker, { password: PASSWORD, confirm: WORD }, { ip: null, userAgent: null }, session);
    await expect(late).rejects.toMatchObject({ status: 409, message: "Istunto on päättynyt. Kirjaudu sisään uudelleen." });
    await expect(resetData(h.s, asker, { password: PASSWORD, confirm: WORD }, { ip: null, userAgent: null }, undefined)).rejects.toMatchObject({ status: 409 });
    whole();
  });

  it("stops before a consent is ended when the asker is no longer an admin", async () => {
    const h = await household();
    const before = await dump(h.db);
    await h.s.users.update(h.adminId, { role: "member" });
    const session = (await h.db.first<{ id: string }>("SELECT id FROM sessions WHERE user_id = ?", [h.adminId]))!.id;
    const was = { ...(await h.s.users.get(h.adminId))!, role: "admin" as const };
    await expect(resetData(h.s, was, { password: PASSWORD, confirm: WORD }, { ip: null, userAgent: null }, session)).rejects.toMatchObject({
      status: 403,
      message: "Tunnuksesi ei ole enää ylläpitäjä, joten mitään ei tyhjennetty.",
    });
    expect(h.bank.calls.some((c) => c.startsWith("DELETE "))).toBe(false);
    expect(existsSync(join(h.dir, "backups"))).toBe(false);
    await h.s.users.update(h.adminId, { role: "admin" });
    expect({ ...(await dump(h.db)), security_events: [] }).toEqual({ ...before, security_events: [] });
  });

  it("comes back whole when the copy is restored", async () => {
    const h = await household();
    const before = await dump(h.db);
    const r = await reset(h.admin);
    expect(r.status).toBe(200);
    expect(readdirSync(join(h.dir, "backups"))).toEqual([r.body.copy]);
    (h.db as Db & { close(): void }).close();

    restoreDatabase(h.dbPath, join("backups", r.body.copy), new Date("2026-10-10T08:00:00Z"));
    const { db } = await openDatabase(h.dbPath);
    open.push(db);
    const after = await dump(db);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const table of Object.keys(before)) expect(after[table], table).toEqual(before[table]);
    expect(after.transactions!.length).toBeGreaterThanOrEqual(6);
    expect(after.users!.length).toBe(3);
    // the copy stays in backups/ and the emptied database is saved beside it
    expect(readdirSync(join(h.dir, "backups")).sort()).toEqual([r.body.copy, "pre-restore-20261010T080000.db"].sort());
  });
});
