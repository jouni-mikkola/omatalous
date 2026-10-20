import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { gateEvent } from "../src/db/startup-gate.ts";
import { noticesFor, recordEvent, validKind } from "../src/services/security.ts";
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

  it("notifies once about failed logins in the last day", async () => {
    const { admin, client } = await setupApp();
    for (let i = 0; i < 3; i++) await client().call("POST", "/api/auth/login", { username: "aino", password: `nope-${i}-password` });
    const notices = (await admin.call("GET", "/api/security/notices")).body.notices as { text: string }[];
    expect(notices.some((n) => n.text.startsWith("Tunnuksellasi epäonnistui 3 kirjautumista"))).toBe(true);
    await admin.call("POST", "/api/security/notices/seen", {});
    expect(((await admin.call("GET", "/api/security/notices")).body.notices as unknown[]).length).toBe(0);
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
    await client().call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }, FIREFOX_LINUX);
    expect(((await admin.call("GET", "/api/security/notices")).body.notices as { kind: string }[]).filter((n) => n.kind === "new_device")).toHaveLength(2);
  });

  it("tells a member when an admin reset the password", async () => {
    const { admin, client } = await setupApp();
    const created = await admin.call("POST", "/api/users", { username: "eero", displayName: "Eero" });
    const eero = client();
    await eero.call("POST", "/api/auth/login", { username: "eero", password: created.body.temporaryPassword });
    await eero.call("POST", "/api/auth/password", { current: created.body.temporaryPassword, next: "eero-uusi-salasana" });
    expect(((await eero.call("GET", "/api/security/notices")).body.notices as { kind: string }[]).some((n) => n.kind === "password_reset_by_admin")).toBe(false);

    const reset = await admin.call("POST", `/api/users/${created.body.user.id}/reset-password`, {});
    const again = client();
    await again.call("POST", "/api/auth/login", { username: "eero", password: reset.body.temporaryPassword });
    await again.call("POST", "/api/auth/password", { current: reset.body.temporaryPassword, next: "eero-kolmas-salasana" });
    const notices = (await again.call("GET", "/api/security/notices")).body.notices as { kind: string; text: string }[];
    expect(notices.find((n) => n.kind === "password_reset_by_admin")?.text).toContain("Ylläpitäjä nollasi salasanasi");
    await again.call("POST", "/api/security/notices/seen", {});
    expect(((await again.call("GET", "/api/security/notices")).body.notices as { kind: string }[]).some((n) => n.kind === "password_reset_by_admin")).toBe(false);
    const kinds = ((await admin.call("GET", "/api/security/events")).body.events as { kind: string }[]).map((e) => e.kind);
    expect(kinds).toContain("password_reset_by_admin");
    expect(kinds).toContain("user_created");
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
    const { s, adminId } = await setupApp();
    const damaged = (waiting: { name: string; why: string } | null) => gateEvent({ state: "damaged", lines: [], reason: "quick_check", waiting }, (iso) => iso);
    for (const waiting of [null, { name: "auto-2026-10-11.db", why: "ENOSPC" }]) await recordEvent(s, { ...damaged(waiting), userId: adminId, notify: true });
    const texts = (await noticesFor(s, { id: adminId, role: "admin" })).filter((n) => n.kind === "db_damaged").map((n) => n.text);
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
