import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { gateEvent } from "../src/db/startup-gate.ts";
import { LOGIN_FAIL_NOTICE, NOTICE_HOURS, noticesFor, recordEvent, validKind } from "../src/services/security.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { setupApp } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const CHROME_WIN = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const FIREFOX_LINUX = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0" };

type Row = { kind: string; detail: string | null; username: string | null; ip: string | null };
const eventsOf = async (call: (m: string, p: string) => Promise<{ body: { events: Row[] } }>) => (await call("GET", "/api/security/events")).body.events;

describe("security events", () => {
  it("records every change of a bank key, the member's own and the shared app's, and never the key", async () => {
    const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const { admin } = await setupApp({}, mockBank().fetchMock);
    const appId = randomUUID();
    expect((await admin.call("PUT", "/api/bank/credentials", { appId, privateKeyPem: pem })).status).toBe(200);
    expect((await admin.call("DELETE", "/api/bank/credentials")).status).toBe(200);
    expect((await admin.call("POST", "/api/admin/bank-app/key")).status).toBe(200);
    expect((await admin.call("PUT", "/api/admin/bank-app", { appId })).status).toBe(200);
    expect((await admin.call("DELETE", "/api/admin/bank-app")).status).toBe(200);
    const events = await eventsOf(admin.call);
    const kinds = ["bank_key_saved", "bank_key_removed", "bank_app_key_made", "bank_app_saved", "bank_app_removed"];
    expect(events.filter((e) => kinds.includes(e.kind)).map((e) => e.kind).sort()).toEqual([...kinds].sort());
    expect(events.filter((e) => kinds.includes(e.kind)).every((e) => e.username === "aino")).toBe(true);
    expect(events.find((e) => e.kind === "bank_app_saved")?.detail).toBe(`Application ID ${appId}`);
    expect(JSON.stringify(events)).not.toContain("PRIVATE KEY");
  });

  it("records a role change with who made it, and nothing when the role stays", async () => {
    const { admin } = await setupApp();
    const created = await admin.call("POST", "/api/users", { username: "eero", displayName: "Eero" });
    const id = created.body.user.id as string;
    expect((await admin.call("PATCH", `/api/users/${id}`, { role: "admin" })).status).toBe(200);
    await admin.call("PATCH", `/api/users/${id}`, { role: "admin", displayName: "Eero V" });
    expect((await admin.call("PATCH", `/api/users/${id}`, { role: "member" })).status).toBe(200);
    const events = await eventsOf(admin.call);
    expect(events.filter((e) => e.kind === "role_changed").map((e) => e.detail).sort()).toEqual(["admin -> member, ylläpitäjä aino", "member -> admin, ylläpitäjä aino"]);
    expect(events.find((e) => e.kind === "user_created")?.detail).toBe("member, eero, ylläpitäjä aino");
  });

  it("writes no event to the log: the table is the one place", async () => {
    const { s } = await setupApp();
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => void logged.push(a));
    await recordEvent(s, { kind: "login_fail", ip: "203.0.113.9", detail: "x" });
    spy.mockRestore();
    expect(JSON.stringify(logged)).not.toContain("203.0.113.9");
  });

  it("records failed logins with the typed user name and shows them to admins, members see only their own", async () => {
    const { admin, member, client } = await setupApp();
    const eero = await member("eero");
    await client().call("POST", "/api/auth/login", { username: "eero", password: "wrong-password-1" });
    await client().call("POST", "/api/auth/login", { username: "nobody", password: "wrong-password-2" });
    const all = (await admin.call("GET", "/api/security/events")).body.events as { kind: string; detail: string; username: string | null }[];
    expect(all.filter((e) => e.kind === "login_fail").map((e) => e.detail).sort()).toEqual(["eero", "nobody"]);
    // no password is stored anywhere in an event
    expect(JSON.stringify(all)).not.toContain("wrong-password");
    const own = (await eero.call("GET", "/api/security/events")).body.events as { kind: string; username: string | null }[];
    expect(own.every((e) => e.username === "eero")).toBe(true);
    expect(own.some((e) => e.kind === "login_fail")).toBe(true);
    expect((await admin.call("GET", "/api/security/events?kind=nonsense")).status).toBe(400);
    expect(((await admin.call("GET", "/api/security/events?kind=login_fail")).body.events as unknown[]).length).toBe(2);
  });

  it("reports a lockout once", async () => {
    const { admin, client } = await setupApp();
    for (let i = 0; i < 14; i++) await client().call("POST", "/api/auth/login", { username: "aino", password: `nope-${i}-password` });
    const events = (await admin.call("GET", "/api/security/events?kind=lockout")).body.events as unknown[];
    expect(events).toHaveLength(1);
  });

  it("tells of failed logins of the last day from the third on, and stops when the day has passed", async () => {
    const { admin, client, s } = await setupApp();
    const fails = async () => ((await admin.call("GET", "/api/security/notices")).body.notices as { kind: string; text: string }[]).filter((n) => n.kind === "login_fail");
    // a mistyped password or two needs nothing done, so nothing is said
    for (let i = 0; i < LOGIN_FAIL_NOTICE - 1; i++) await client().call("POST", "/api/auth/login", { username: "aino", password: `nope-${i}-password` });
    expect(await fails()).toEqual([]);
    await client().call("POST", "/api/auth/login", { username: "aino", password: "nope-last-password" });
    expect((await fails()).map((n) => n.text)).toEqual(["Tunnuksellasi epäonnistui 3 kirjautumista viime vuorokauden aikana."]);
    // it goes on its own: there is nothing to press
    const now = s.now().getTime();
    vi.spyOn(s, "now").mockReturnValue(new Date(now + 25 * 3600_000));
    expect(await noticesFor(s, { id: (await s.users.findForLogin("aino"))!.id, role: "admin" })).toEqual([]);
  });

  it("marks the notices of the events so far seen for the user who opened them, and a later event unseen", async () => {
    const { admin, s, adminId, client } = await setupApp();
    const at = vi.spyOn(s, "now");
    const start = s.now().getTime();
    const seenOf = async () => ((await admin.call("GET", "/api/security/notices")).body.notices as { kind: string; seen?: boolean }[]).map((n) => [n.kind, n.seen]);
    await recordEvent(s, { kind: "recovery_code_used", userId: adminId, notify: true });
    for (let i = 0; i < LOGIN_FAIL_NOTICE; i++) await client().call("POST", "/api/auth/login", { username: "aino", password: `nope-${i}-password` });
    expect(await seenOf()).toEqual([["recovery_code_used", false], ["login_fail", false]]);
    at.mockReturnValue(new Date(start + 60_000));
    expect((await admin.call("POST", "/api/security/notices/seen")).status).toBe(200);
    // the notices stay for their time, read
    expect(await seenOf()).toEqual([["recovery_code_used", true], ["login_fail", true]]);
    at.mockReturnValue(new Date(start + 120_000));
    await recordEvent(s, { kind: "password_reset_by_admin", userId: adminId, notify: true });
    await client().call("POST", "/api/auth/login", { username: "aino", password: "nope-later-password" });
    expect(await seenOf()).toEqual([["recovery_code_used", true], ["password_reset_by_admin", false], ["login_fail", false]]);
    // another member's mark is their own
    const eero = (await admin.call("POST", "/api/users", { username: "eero", displayName: "Eero" })).body.user.id as string;
    await recordEvent(s, { kind: "recovery_code_used", userId: eero, notify: true });
    expect((await noticesFor(s, { id: eero, role: "member" })).map((n) => n.seen)).toEqual([false]);
    // a notice of a state has no mark: it lasts while its cause does
    expect((await admin.call("POST", "/api/security/notices/seen")).status).toBe(200);
    expect((await noticesFor(s, { id: adminId, role: "admin" })).filter((n) => n.seen === undefined)).toEqual([]);
  });

  it("shows the notice of an event for NOTICE_HOURS and then no more", async () => {
    const { s, adminId } = await setupApp();
    const me = { id: adminId, role: "admin" };
    const start = s.now().getTime();
    const at = vi.spyOn(s, "now");
    for (const kind of ["password_reset_by_admin", "factor_removed_by_admin", "recovery_code_used", "new_device", "ops_notice", "watchdog_notice", "db_restored"]) await recordEvent(s, { kind, userId: adminId, detail: "x", notify: true });
    at.mockReturnValue(new Date(start + (NOTICE_HOURS - 1) * 3600_000));
    expect(await noticesFor(s, me)).toHaveLength(7);
    at.mockReturnValue(new Date(start + (NOTICE_HOURS + 1) * 3600_000));
    expect(await noticesFor(s, me)).toEqual([]);
    // the event itself stays in the log
    expect(await s.security.list({ userId: adminId, kind: "recovery_code_used", limit: 5 })).toHaveLength(1);
  });

  it("notifies about a login from a new device, but not from a known one", async () => {
    const { admin, client } = await setupApp();
    // the first login ever (setup) has no history to compare with
    expect(((await admin.call("GET", "/api/security/notices")).body.notices as unknown[]).length).toBe(0);
    const a = client();
    await a.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }, CHROME_WIN);
    const b = client();
    await b.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }, CHROME_WIN);
    const notices = (await admin.call("GET", "/api/security/notices")).body.notices as { kind: string; text: string }[];
    expect(notices.filter((n) => n.kind === "new_device")).toHaveLength(1); // Chrome was new once
    expect(notices.find((n) => n.kind === "new_device")!.text).toContain("Chrome, Windows");
    // the first page names the device in its row: the field is the device alone, and no other notice has it
    expect((notices.find((n) => n.kind === "new_device") as { detail?: string }).detail).toBe("Chrome, Windows");
    expect(notices.filter((n) => n.kind !== "new_device" && "detail" in n)).toEqual([]);
    expect(notices.find((n) => n.kind === "new_device")!.text).toMatch(/ Jos et kirjautunut itse, vaihda salasana ja kirjaa kaikki istunnot ulos\.$/);
    const fox = client();
    await fox.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }, FIREFOX_LINUX);
    expect(((await admin.call("GET", "/api/security/notices")).body.notices as { kind: string }[]).filter((n) => n.kind === "new_device")).toHaveLength(2);
    // the new device is not told of its own sign-in: whoever sits there knows, and has nothing to do about it
    const own = ((await fox.call("GET", "/api/security/notices", undefined, FIREFOX_LINUX)).body.notices as { kind: string; detail?: string }[]).filter((n) => n.kind === "new_device");
    expect(own.map((n) => n.detail)).toEqual(["Chrome, Windows"]);
  });

  it("does not tell an admin of a reset or a factor removal they did to their own account", async () => {
    const { admin, s, adminId, client } = await setupApp();
    const reset = await admin.call("POST", `/api/users/${adminId}/reset-password`, {});
    const again = client();
    await again.call("POST", "/api/auth/login", { username: "aino", password: reset.body.temporaryPassword });
    await again.call("POST", "/api/auth/first-password", { next: "aino-uusi-salasana-1" });
    // the command line is the admin's own tool
    await recordEvent(s, { kind: "factor_removed_by_admin", userId: adminId, detail: "komentorivi", notify: true });
    expect(((await again.call("GET", "/api/security/notices")).body.notices as { kind: string }[]).map((n) => n.kind)).toEqual([]);
    // another admin's action is told, and the events stay in the log
    await recordEvent(s, { kind: "password_reset_by_admin", userId: adminId, detail: "ylläpitäjä eero", notify: true });
    expect(((await again.call("GET", "/api/security/notices")).body.notices as { kind: string }[]).map((n) => n.kind)).toEqual(["password_reset_by_admin"]);
    expect(await s.security.list({ userId: adminId, kind: "password_reset_by_admin", limit: 5 })).toHaveLength(2);
  });

  it("tells a member when an admin reset the password", async () => {
    const { admin, client } = await setupApp();
    const created = await admin.call("POST", "/api/users", { username: "eero", displayName: "Eero" });
    const eero = client();
    await eero.call("POST", "/api/auth/login", { username: "eero", password: created.body.temporaryPassword });
    await eero.call("POST", "/api/auth/first-password", { next: "eero-uusi-salasana" });
    expect(((await eero.call("GET", "/api/security/notices")).body.notices as { kind: string }[]).some((n) => n.kind === "password_reset_by_admin")).toBe(false);

    const reset = await admin.call("POST", `/api/users/${created.body.user.id}/reset-password`, {});
    const again = client();
    await again.call("POST", "/api/auth/login", { username: "eero", password: reset.body.temporaryPassword });
    await again.call("POST", "/api/auth/first-password", { next: "eero-kolmas-salasana" });
    const notices = (await again.call("GET", "/api/security/notices")).body.notices as { kind: string; text: string }[];
    expect(notices.find((n) => n.kind === "password_reset_by_admin")?.text).toContain("Ylläpitäjä nollasi salasanasi");
    const kinds = ((await admin.call("GET", "/api/security/events")).body.events as { kind: string }[]).map((e) => e.kind);
    expect(kinds).toContain("password_reset_by_admin");
    expect(kinds).toContain("user_created");
  });

  it("shows two resets in the same minute as one notice", async () => {
    const { s, adminId } = await setupApp();
    vi.spyOn(s, "now").mockReturnValue(new Date("2026-11-12T01:10:00Z"));
    for (let i = 0; i < 2; i++) await recordEvent(s, { kind: "password_reset_by_admin", userId: adminId, detail: "ylläpitäjä eero", notify: true });
    const resets = (await noticesFor(s, { id: adminId, role: "admin" })).filter((n) => n.kind === "password_reset_by_admin");
    expect(resets).toHaveLength(1);
  });

  it("drops the read marks an earlier version stored, and an event marked as read then is told again within its time", async () => {
    const { s, adminId, db } = await setupApp();
    await s.settings.set(`notice_fail_seen:${adminId}`, "2026-01-01T00:00:00.000Z");
    await s.settings.set(`notice_health_seen:${adminId}`, JSON.stringify({ disk_low: "2026-01-01T00:00:00.000Z" }));
    await s.settings.set("notice_industry_lookup_off", "2026-01-01T00:00:00.000Z");
    await recordEvent(s, { kind: "recovery_code_used", userId: adminId, notify: true });
    await db.run("UPDATE security_events SET seen_at = ? WHERE kind = 'recovery_code_used'", [s.now().toISOString()]);
    expect(await runUpgradeTasks(s, "1.0.1+test")).not.toBeNull();
    expect(await s.settings.keysWithPrefix("notice_fail_seen:")).toEqual([]);
    expect(await s.settings.keysWithPrefix("notice_health_seen:")).toEqual([]);
    // the changed default is no read mark: it stays until an admin saves the settings
    expect(await s.settings.get("notice_industry_lookup_off")).not.toBeNull();
    expect((await noticesFor(s, { id: adminId, role: "admin" })).map((n) => n.kind)).toEqual(["recovery_code_used", "industry_lookup_off"]);
  });

  it("shows a user only their own events", async () => {
    const { admin, s, adminId } = await setupApp();
    const eero = (await admin.call("POST", "/api/users", { username: "eero", displayName: "Eero" })).body.user.id as string;
    await recordEvent(s, { kind: "recovery_code_used", userId: eero, notify: true });
    expect(await noticesFor(s, { id: adminId, role: "admin" })).toEqual([]);
    expect((await noticesFor(s, { id: eero, role: "member" })).map((n) => n.kind)).toEqual(["recovery_code_used"]);
  });

  it("lists own sessions with device and last use, ends one, and ends all", async () => {
    const { admin, client } = await setupApp();
    const phone = client();
    await phone.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }, CHROME_WIN);
    const list = (await admin.call("GET", "/api/security/sessions")).body.sessions as { id: string; device: string; current: boolean; lastSeenAt: string }[];
    expect(list).toHaveLength(2);
    expect(list.filter((x) => x.current)).toHaveLength(1);
    expect(list.map((x) => x.device).sort()).toEqual(["Chrome, Windows", "Tuntematon laite"]);
    expect(list.every((x) => x.id.length === 20 && x.lastSeenAt)).toBe(true);

    const other = list.find((x) => !x.current)!;
    expect((await admin.call("DELETE", `/api/security/sessions/${other.id}`)).status).toBe(200);
    expect((await phone.call("GET", "/api/meta")).status).toBe(401);
    expect((await admin.call("DELETE", `/api/security/sessions/${other.id}`)).status).toBe(400);
    expect((await admin.call("DELETE", "/api/security/sessions/short")).status).toBe(400);

    const second = client();
    await second.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" });
    await admin.call("POST", "/api/security/sessions/revoke-all", { keepCurrent: true });
    expect((await second.call("GET", "/api/meta")).status).toBe(401);
    expect((await admin.call("GET", "/api/meta")).status).toBe(200);
    await admin.call("POST", "/api/security/sessions/revoke-all", {});
    expect((await admin.call("GET", "/api/meta")).status).toBe(401);
  });

  it("records the address and browser of the request behind an ended session", async () => {
    const { admin, s } = await setupApp();
    await admin.call("POST", "/api/security/sessions/revoke-all", { keepCurrent: true }, FIREFOX_LINUX);
    const events = await s.security.list({ kind: "session_revoked", limit: 5 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ip: "local", userAgent: FIREFOX_LINUX["User-Agent"] });
  });

  it("tells an admin of a damaged database in Finnish: what to do next and where, no English heading, one name for a copy", async () => {
    const damaged = (waiting: { name: string; why: string } | null) => gateEvent({ state: "damaged", lines: [], reason: "quick_check", waiting }, (iso) => iso);
    const texts: string[] = [];
    for (const waiting of [null, { name: "auto-2026-10-11.db", why: "ENOSPC" }]) {
      // the notice is the state of the start (`dbDamaged`), told to admins while the server runs on the damaged file
      const { s, adminId, admin } = await setupApp({}, undefined, { dbDamaged: damaged(waiting).detail });
      const member = (await admin.call("POST", "/api/users", { username: "eero", displayName: "Eero" })).body.user.id as string;
      expect(await noticesFor(s, { id: member, role: "member" })).toEqual([]);
      const mine = (await noticesFor(s, { id: adminId, role: "admin" })).filter((n) => n.kind === "db_damaged");
      expect(mine.map((n) => n.id)).toEqual(["db_damaged"]);
      texts.push(mine[0]!.text);
      // days later it is still told: its cause has not ended
      vi.spyOn(s, "now").mockReturnValue(new Date(s.now().getTime() + 30 * 86_400_000));
      expect((await noticesFor(s, { id: adminId, role: "admin" })).map((n) => n.kind)).toEqual(["db_damaged"]);
    }
    // a server that started on a whole database tells of none, whatever its log holds
    const whole = await setupApp();
    await recordEvent(whole.s, { ...damaged(null), userId: whole.adminId });
    expect(await noticesFor(whole.s, { id: whole.adminId, role: "admin" })).toEqual([]);
    expect(texts).toHaveLength(2);
    for (const text of texts) {
      expect(text).not.toContain("Restore a backup");
      expect(text).not.toMatch(/(^|[^a-zäö])kopio/i);
    }
    // both cases end with the restore by hand: a restart has tried the waiting copy already, so a button would try the same again
    for (const text of texts) expect(text).toContain("./scripts/restore.sh. Ohje on tiedostossa docs/ADVANCED.md.");
    expect(texts.filter((t) => t.includes("käynnistä sovellus uudelleen"))).toHaveLength(1);
  });

  it("a member cannot end another member's session", async () => {
    const { admin, member } = await setupApp();
    const eero = await member("eero");
    const mine = (await admin.call("GET", "/api/security/sessions")).body.sessions[0].id as string;
    expect((await eero.call("DELETE", `/api/security/sessions/${mine}`)).status).toBe(400);
    expect((await admin.call("GET", "/api/meta")).status).toBe(200);
  });

  it("takes maintenance events from other code, validates kinds, and prunes by count and age", async () => {
    const { admin, s } = await setupApp();
    expect(validKind("ops_update_started")).toBe(true);
    expect(validKind("ops_")).toBe(false);
    expect(validKind("anything")).toBe(false);
    await expect(recordEvent(s, { kind: "bogus" })).rejects.toThrow();
    await recordEvent(s, { kind: "ops_update_requested", detail: "versio\n0.3.0".repeat(100) });
    const ev = (await admin.call("GET", "/api/security/events?kind=ops_update_requested")).body.events as { detail: string }[];
    expect(ev).toHaveLength(1);
    expect(ev[0]!.detail.length).toBeLessThanOrEqual(200);
    expect(ev[0]!.detail).not.toContain("\n");

    for (let i = 0; i < 10; i++) await recordEvent(s, { kind: "ops_backup_done" });
    await s.security.prune("2000-01-01T00:00:00Z", 5);
    expect(await s.security.list({ limit: 100 })).toHaveLength(5);
    await s.security.prune("2999-01-01T00:00:00Z", 5);
    expect(await s.security.list({ limit: 100 })).toHaveLength(0);
  });

  it("removing a member removes their events and notices", async () => {
    const { admin, member, s } = await setupApp();
    const eero = await member("eero");
    expect((await s.security.list({ userId: eero.id, limit: 50 })).length).toBeGreaterThan(0);
    await admin.call("DELETE", `/api/users/${eero.id}`);
    expect(await s.security.list({ userId: eero.id, limit: 50 })).toHaveLength(0);
  });
});
