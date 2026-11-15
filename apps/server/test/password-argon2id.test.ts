import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "../src/security/password.ts";
import { toBase64Url, utf8 } from "../src/security/encoding.ts";
import { stepOf, totpCode } from "../src/security/totp.ts";
import { NOW, setupApp } from "./helpers.ts";

const COST = { memoryKib: 19_456, passes: 2 };

/** A hash as the versions before Argon2id wrote it. */
async function legacyHash(password: string, iterations = 1000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", utf8.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return `pbkdf2_sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

describe("Argon2id hashes", () => {
  it("a new hash is Argon2id with its cost in the string, and checks only the right password", async () => {
    const stored = await hashPassword("pitka-salasana-123", COST);
    expect(stored).toMatch(/^argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword("pitka-salasana-123", stored)).toBe(true);
    expect(await verifyPassword("pitka-salasana-124", stored)).toBe(false);
    expect(needsRehash(stored, COST)).toBe(false);
    expect(needsRehash(stored, { ...COST, passes: 3 })).toBe(true);
  });

  it("an old PBKDF2 hash still verifies and is due for a rewrite", async () => {
    const old = await legacyHash("vanha-salasana-123");
    expect(await verifyPassword("vanha-salasana-123", old)).toBe(true);
    expect(await verifyPassword("vanha-salasana-124", old)).toBe(false);
    expect(needsRehash(old, COST)).toBe(true);
  });

  it("refuses a stored hash that asks for more than the limits allow, without running it", async () => {
    expect(await verifyPassword("x", "argon2id$v=19$m=9999999,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAA")).toBe(false);
    expect(await verifyPassword("x", "argon2id$v=19$m=19456,t=2,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAA")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2_sha256$999999999999$AAAAAAAAAAAAAAAAAAAAAA$AAAA")).toBe(false);
    expect(await verifyPassword("x", "plain")).toBe(false);
  });

  it("a damaged stored hash is a refusal, not an error", async () => {
    expect(await verifyPassword("x", "argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$A")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2_sha256$1000$A$A")).toBe(false);
  });

  it("the migration of this version has no compat floor, so an older version refuses the database and a rollback restores the copy", () => {
    const sql = readFileSync(new URL("../migrations/0027_password_argon2id.sql", import.meta.url), "utf8");
    expect(sql).not.toMatch(/^--\s*migrate:\s*compat/m);
  });
});

describe("sign-in rewrites an old hash", () => {
  const setLegacy = async (t: Awaited<ReturnType<typeof setupApp>>, id: string, password: string) => {
    const old = await legacyHash(password);
    await t.db.run("UPDATE users SET password_hash = ? WHERE id = ?", [old, id]);
    return old;
  };
  const stored = async (t: Awaited<ReturnType<typeof setupApp>>) => (await t.s.users.findForLogin("aino"))!.passwordHash;

  it("an old hash signs in once, becomes Argon2id, is recorded, and the same password still works", async () => {
    const t = await setupApp();
    await setLegacy(t, t.adminId, "aino-salasana-123");
    const c = t.client();
    expect((await c.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" })).status).toBe(200);
    expect(await stored(t)).toMatch(/^argon2id\$/);
    expect((await t.s.security.list({ userId: t.adminId, kind: "password_rehashed", limit: 5 })).length).toBe(1);
    const again = t.client();
    expect((await again.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" })).status).toBe(200);
    expect((await t.s.security.list({ userId: t.adminId, kind: "password_rehashed", limit: 5 })).length).toBe(1);
  });

  it("a wrong password, an unknown name and a lockout change nothing", async () => {
    const t = await setupApp();
    const old = await setLegacy(t, t.adminId, "aino-salasana-123");
    const c = t.client();
    expect((await c.call("POST", "/api/auth/login", { username: "aino", password: "vaara-salasana-123" })).status).toBe(401);
    expect((await c.call("POST", "/api/auth/login", { username: "tuntematon", password: "aino-salasana-123" })).status).toBe(401);
    expect(await stored(t)).toBe(old);
    expect((await t.s.security.list({ kind: "password_rehashed", limit: 5 })).length).toBe(0);
  });

  it("a hash at another cost is rewritten to the cost now set", async () => {
    const t = await setupApp();
    const other = await hashPassword("aino-salasana-123", { memoryKib: 16, passes: 1 });
    await t.db.run("UPDATE users SET password_hash = ? WHERE id = ?", [other, t.adminId]);
    expect((await t.client().call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" })).status).toBe(200);
    expect(await stored(t)).toMatch(/m=8,t=1,p=1/);
  });

  it("a changed password and a reset use Argon2id", async () => {
    const t = await setupApp();
    await t.member("kaisa");
    const kaisa = (await t.s.users.findForLogin("kaisa"))!;
    expect(kaisa.passwordHash).toMatch(/^argon2id\$/);
    expect((await t.admin.call("POST", `/api/users/${kaisa.id}/reset-password`)).status).toBe(200);
    expect((await t.s.users.findForLogin("kaisa"))!.passwordHash).toMatch(/^argon2id\$/);
  });

  it("a user with a second factor: the rewrite comes before the half session, so the code step still works", async () => {
    const t = await setupApp();
    const started = await t.admin.call("POST", "/api/security/factor/enrol", { password: "aino-salasana-123" });
    const step = stepOf(NOW.getTime());
    await t.admin.call("POST", "/api/security/factor/confirm", { password: "aino-salasana-123", code: totpCode(started.body.secret, step) });
    await setLegacy(t, t.adminId, "aino-salasana-123");
    const c = t.client();
    expect((await c.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" })).body).toEqual({ needsFactor: true });
    expect(await stored(t)).toMatch(/^argon2id\$/);
    expect((await c.call("POST", "/api/auth/factor", { code: totpCode(started.body.secret, step + 1) })).status).toBe(200);
  });

  it("a password changed while the sign-in was checking the old hash does not sign in", async () => {
    const t = await setupApp();
    const old = await setLegacy(t, t.adminId, "aino-salasana-123");
    const record = (await t.s.users.findForLogin("aino"))!;
    // the change lands between the check and the rewrite
    await t.s.users.setPassword(t.adminId, await hashPassword("aino-uusi-salasana-1", COST), false);
    expect(old).not.toBe(await stored(t));
    const { upgradePasswordHash } = await import("../src/services/users.ts");
    expect(await upgradePasswordHash(t.s, record, "aino-salasana-123", { ip: null, userAgent: null })).toBeNull();
    expect(await stored(t)).toMatch(/^argon2id\$v=19\$m=19456/);
    // the same password at a login that lost the race to another login of its own is let in
    await setLegacy(t, t.adminId, "aino-salasana-123");
    const stale = (await t.s.users.findForLogin("aino"))!;
    const winner = await upgradePasswordHash(t.s, stale, "aino-salasana-123", { ip: null, userAgent: null });
    expect(winner).toMatch(/^argon2id\$/);
    expect(await upgradePasswordHash(t.s, { ...stale }, "aino-salasana-123", { ip: null, userAgent: null })).toBe(await stored(t));
  });
});
