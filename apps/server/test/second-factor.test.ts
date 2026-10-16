import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { SecretBox } from "../src/security/secretbox.ts";
import { resealAll } from "../src/services/secret-rotation.ts";
import { resetPassword } from "../src/services/users.ts";
import { newSecret, otpauthUri, stepOf, totpCode } from "../src/security/totp.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { secretFileDiffers } from "../src/entry/secret-rotate.ts";
import { NOW, scratchDir, setupApp } from "./helpers.ts";

const STEP = stepOf(NOW.getTime());
const PASSWORD = "aino-salasana-123";

/** Enrols a client's user with a code of `step` and returns the secret and the recovery codes. */
async function enrol(c: Awaited<ReturnType<typeof setupApp>>["admin"], step = STEP, password = PASSWORD) {
  const started = await c.call("POST", "/api/security/factor/enrol", { password });
  expect(started.status).toBe(200);
  const confirmed = await c.call("POST", "/api/security/factor/confirm", { password, code: totpCode(started.body.secret, step) });
  expect(confirmed.status).toBe(200);
  return { secret: started.body.secret as string, recovery: confirmed.body.recoveryCodes as string[] };
}

async function events(app: Awaited<ReturnType<typeof setupApp>>, userId: string, kind: string) {
  return app.db.all<{ detail: string | null }>("SELECT detail FROM security_events WHERE user_id = ? AND kind = ? ORDER BY id", [userId, kind]);
}

describe("TOTP (RFC 6238)", () => {
  // Appendix B: the SHA-1 secret is the ASCII text "12345678901234567890", codes of 8 digits
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  it.each(vectors)("time %i gives %s", (time, code) => {
    expect(totpCode(secret, Math.floor(time / 30), 8)).toBe(code);
    expect(totpCode(secret, Math.floor(time / 30))).toBe(code.slice(2));
  });

  it("a secret is 20 bytes in base32 and the address names the issuer", () => {
    expect(newSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri("aino", "ABC")).toBe("otpauth://totp/Omatalous:aino?secret=ABC&issuer=Omatalous");
  });
});

describe("second factor: enrolment", () => {
  it("stores nothing until a valid code, then seals the secret and hashes the recovery codes", async () => {
    const t = await setupApp();
    const started = await t.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD });
    expect(started.body.uri).toBe(`otpauth://totp/Omatalous:aino?secret=${started.body.secret}&issuer=Omatalous`);
    expect(started.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect((await t.admin.call("GET", "/api/security/factor")).body).toMatchObject({ enabled: false, recoveryLeft: 0 });
    expect(await t.db.all("SELECT 1 FROM user_factor")).toHaveLength(0);

    const wrong = await t.admin.call("POST", "/api/security/factor/confirm", { password: PASSWORD, code: totpCode(started.body.secret, STEP + 2) });
    expect(wrong.status).toBe(400);
    expect(await t.db.all("SELECT 1 FROM user_factor")).toHaveLength(0);

    const ok = await t.admin.call("POST", "/api/security/factor/confirm", { password: PASSWORD, code: totpCode(started.body.secret, STEP + 1) });
    expect(ok.status).toBe(200);
    expect(ok.body.recoveryCodes).toHaveLength(10);
    expect(new Set(ok.body.recoveryCodes).size).toBe(10);
    expect(ok.body.recoveryCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect((await t.admin.call("GET", "/api/security/factor")).body).toMatchObject({ enabled: true, recoveryLeft: 10 });

    const rows = await t.db.all<{ kind: string; secret: string }>("SELECT kind, secret FROM user_factor");
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(started.body.secret);
    for (const code of ok.body.recoveryCodes as string[]) expect(dump).not.toContain(code.replace("-", ""));
    expect(rows.find((r) => r.kind === "totp")!.secret).toMatch(/^v1\./);
    expect((await events(t, t.adminId, "factor_on")).length).toBe(1);
  });

  it("confirming without a started enrolment, or twice, is refused", async () => {
    const t = await setupApp();
    expect((await t.admin.call("POST", "/api/security/factor/confirm", { password: PASSWORD, code: "123456" })).status).toBe(400);
    const { secret } = await enrol(t.admin);
    expect((await t.admin.call("POST", "/api/security/factor/confirm", { password: PASSWORD, code: totpCode(secret, STEP + 1) })).status).toBe(409);
    expect((await t.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD })).status).toBe(400);
  });

  it("is for a signed-in user", async () => {
    const t = await setupApp();
    expect((await t.client().call("POST", "/api/security/factor/enrol")).status).toBe(401);
  });
});

describe("second factor: sign-in", () => {
  it("a half session reaches nothing but the code", async () => {
    const t = await setupApp();
    const { secret } = await enrol(t.admin);
    const c = t.client();
    const login = await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ needsFactor: true });
    expect(login.res.headers.get("set-cookie")).toContain("_half=");
    expect(login.res.headers.get("set-cookie")).toContain("HttpOnly");

    expect((await c.call("GET", "/api/meta")).status).toBe(401);
    expect((await c.call("GET", "/api/security/sessions")).status).toBe(401);
    expect((await c.call("POST", "/api/security/factor/enrol")).status).toBe(401);
    expect((await c.call("GET", "/api/auth/state")).body.user).toBeNull();
    expect(await t.db.all("SELECT 1 FROM sessions WHERE user_id = ?", [t.adminId])).toHaveLength(1); // the enrolling session only
    expect(await events(t, t.adminId, "login_ok")).toHaveLength(1);

    const done = await c.call("POST", "/api/auth/factor", { code: totpCode(secret, STEP + 1) });
    expect(done.status).toBe(200);
    expect(done.body.user.username).toBe("aino");
    expect((await c.call("GET", "/api/meta")).status).toBe(200);
    expect(await events(t, t.adminId, "login_ok")).toHaveLength(2);
  });

  it("a code without a half session, or a wrong one, signs nobody in", async () => {
    const t = await setupApp();
    const { secret } = await enrol(t.admin);
    expect((await t.client().call("POST", "/api/auth/factor", { code: totpCode(secret, STEP + 1) })).status).toBe(401);
    const c = t.client();
    await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    const wrong = await c.call("POST", "/api/auth/factor", { code: "000000" });
    expect(wrong.status).toBe(401);
    expect((await c.call("GET", "/api/meta")).status).toBe(401);
    // the wrong password never gets as far as a half session
    expect((await t.client().call("POST", "/api/auth/login", { username: "aino", password: "ei-oikea-salasana" })).status).toBe(401);
  });

  it("the half session ends after five minutes", async () => {
    let clock = new Date(NOW);
    const t = await setupApp({}, undefined, { now: () => clock });
    const { secret } = await enrol(t.admin);
    const c = t.client();
    await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    clock = new Date(NOW.getTime() + 5 * 60_000 - 1000);
    // a step later than the confirming one: 4 minutes 59 seconds on, the code of the step after is within reach
    const late = await c.call("POST", "/api/auth/factor", { code: totpCode(secret, stepOf(clock.getTime())) });
    expect(late.status).toBe(200);
    const d = t.client();
    await d.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    clock = new Date(clock.getTime() + 5 * 60_000 + 1000);
    const expired = await d.call("POST", "/api/auth/factor", { code: totpCode(secret, stepOf(clock.getTime())) });
    expect(expired.status).toBe(401);
    expect(expired.body.code).toBe("half_expired");
  });

  it("the code of a step used is refused again, an older one too, the next one passes", async () => {
    const t = await setupApp();
    const { secret } = await enrol(t.admin, STEP);
    const signIn = async (step: number) => {
      const c = t.client();
      await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
      return (await c.call("POST", "/api/auth/factor", { code: totpCode(secret, step) })).status;
    };
    expect(await signIn(STEP)).toBe(401); // the code that confirmed the enrolment
    expect(await signIn(STEP + 1)).toBe(200);
    expect(await signIn(STEP + 1)).toBe(401);
    expect(await signIn(STEP)).toBe(401);
    expect(await signIn(STEP - 1)).toBe(401);
    expect(await signIn(STEP + 2)).toBe(401); // two ahead is outside the window
  });

  it("a step one back is taken, two back is not", async () => {
    const t = await setupApp();
    const { secret } = await enrol(t.admin, STEP - 1);
    const signIn = async (step: number) => {
      const c = t.client();
      await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
      return (await c.call("POST", "/api/auth/factor", { code: totpCode(secret, step) })).status;
    };
    expect(await signIn(STEP - 2)).toBe(401);
    expect(await signIn(STEP)).toBe(200);
  });

  it("a recovery code works once, in any case and without the dash", async () => {
    const t = await setupApp();
    const { recovery } = await enrol(t.admin);
    const signIn = async (code: string) => {
      const c = t.client();
      await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
      return (await c.call("POST", "/api/auth/factor", { code })).status;
    };
    expect(await signIn(recovery[0]!.toLowerCase().replace("-", " "))).toBe(200);
    expect(await signIn(recovery[0]!)).toBe(401);
    expect(await signIn(recovery[1]!)).toBe(200);
    expect(await signIn("ABCDE-FGHJK")).toBe(401);
    expect((await t.admin.call("GET", "/api/security/factor")).body.recoveryLeft).toBe(8);
    expect(await events(t, t.adminId, "recovery_code_used")).toHaveLength(2);
    expect((await t.admin.call("GET", "/api/security/notices")).body.notices.some((n: { kind: string }) => n.kind === "recovery_code_used")).toBe(true);
  });

  it("a user without a factor signs in as before", async () => {
    const t = await setupApp();
    const m = await t.member("liisa");
    const again = t.client();
    const login = await again.call("POST", "/api/auth/login", { username: "liisa", password: "liisa-uusi-salasana" });
    expect(login.body.user.username).toBe("liisa");
    expect(m.id).toBe(login.body.user.id);
  });
});

describe("second factor: throttle", () => {
  it("the sixth wrong code is refused even when it is right; four wrong then a right one passes", async () => {
    const t = await setupApp();
    const { secret } = await enrol(t.admin);
    const near = t.client();
    await near.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    for (let i = 0; i < 4; i++) expect((await near.call("POST", "/api/auth/factor", { code: "000000" })).status).toBe(401);
    expect((await near.call("POST", "/api/auth/factor", { code: totpCode(secret, STEP + 1) })).status).toBe(200);

    const c = t.client();
    await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    // the success above gave its attempts back, so five more wrong ones are counted from none
    for (let i = 0; i < 5; i++) expect((await c.call("POST", "/api/auth/factor", { code: "000000" })).status).toBe(401);
    const locked = await c.call("POST", "/api/auth/factor", { code: totpCode(secret, STEP + 1) });
    expect(locked.status).toBe(429);
    expect(locked.res.headers.get("retry-after")).toBeTruthy();

    // a fresh password sign-in from the same address does not clear it
    const d = t.client();
    await d.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    expect((await d.call("POST", "/api/auth/factor", { code: totpCode(secret, STEP + 1) })).status).toBe(429);

    const fails = await events(t, t.adminId, "login_fail");
    expect(fails.filter((e) => e.detail === "koodi, aino")).toHaveLength(9);
    expect(await events(t, t.adminId, "lockout")).toHaveLength(1);
  });

  it("wrong codes of removal and confirmation count in the same throttle", async () => {
    const t = await setupApp();
    const started = await t.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD });
    for (let i = 0; i < 5; i++) expect((await t.admin.call("POST", "/api/security/factor/confirm", { password: PASSWORD, code: "000000" })).status).toBe(400);
    expect((await t.admin.call("POST", "/api/security/factor/confirm", { password: PASSWORD, code: totpCode(started.body.secret, STEP) })).status).toBe(429);
  });
});

describe("second factor: removal and recovery codes", () => {
  it("removing needs the password and a code; the user then signs in with the password alone", async () => {
    const t = await setupApp();
    const { secret, recovery } = await enrol(t.admin);
    const code = totpCode(secret, STEP + 1);
    expect((await t.admin.call("POST", "/api/security/factor/remove", { password: "vaara-salasana-1", code })).status).toBe(400);
    expect((await t.admin.call("POST", "/api/security/factor/remove", { password: PASSWORD, code: "000000" })).status).toBe(400);
    expect((await t.admin.call("POST", "/api/security/factor/remove", { password: PASSWORD })).status).toBe(400);
    expect((await t.admin.call("GET", "/api/security/factor")).body.enabled).toBe(true);
    // a recovery code does as the code
    expect((await t.admin.call("POST", "/api/security/factor/remove", { password: PASSWORD, code: recovery[3] })).status).toBe(200);
    expect((await t.admin.call("GET", "/api/security/factor")).body).toMatchObject({ enabled: false, recoveryLeft: 0 });
    expect(await t.db.all("SELECT 1 FROM user_factor")).toHaveLength(0);
    expect((await t.client().call("POST", "/api/auth/login", { username: "aino", password: PASSWORD })).body.user.username).toBe("aino");
    expect((await events(t, t.adminId, "factor_off")).length).toBe(1);
  });

  it("new recovery codes replace the old ones", async () => {
    const t = await setupApp();
    const { secret, recovery } = await enrol(t.admin);
    expect((await t.admin.call("POST", "/api/security/factor/recovery-codes", { password: "vaara-salasana-1", code: totpCode(secret, STEP + 1) })).status).toBe(400);
    const made = await t.admin.call("POST", "/api/security/factor/recovery-codes", { password: PASSWORD, code: totpCode(secret, STEP + 1) });
    expect(made.status).toBe(200);
    expect(made.body.recoveryCodes).toHaveLength(10);
    expect((await t.admin.call("GET", "/api/security/factor")).body.recoveryLeft).toBe(10);
    const signIn = async (code: string) => {
      const c = t.client();
      await c.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
      return (await c.call("POST", "/api/auth/factor", { code })).status;
    };
    expect(await signIn(recovery[0]!)).toBe(401);
    expect(await signIn(made.body.recoveryCodes[0])).toBe(200);
  });

  it("an admin removes a member's factor and it is recorded; an admin's own only that admin removes", async () => {
    const t = await setupApp();
    const liisa = await t.member("liisa");
    await enrol(liisa, STEP, "liisa-uusi-salasana");
    expect((await events(t, liisa.id, "factor_on")).length).toBe(1);

    // a member cannot remove another's, nor an admin's
    const matti = await t.member("matti");
    expect((await matti.call("DELETE", `/api/users/${liisa.id}/factor`)).status).toBe(403);
    expect((await matti.call("DELETE", `/api/users/${t.adminId}/factor`)).status).toBe(403);
    expect((await liisa.call("GET", "/api/security/factor")).body.enabled).toBe(true);

    // a member without one: nothing to remove
    expect((await t.admin.call("DELETE", `/api/users/${matti.id}/factor`)).status).toBe(400);

    const removed = await t.admin.call("DELETE", `/api/users/${liisa.id}/factor`);
    expect(removed.status).toBe(200);
    // the removal ended Liisa's sessions: she signs in with the password alone
    const again = t.client();
    expect((await again.call("POST", "/api/auth/login", { username: "liisa", password: "liisa-uusi-salasana" })).body.user.username).toBe("liisa");
    expect((await again.call("GET", "/api/security/factor")).body).toMatchObject({ enabled: false, recoveryLeft: 0 });
    expect((await events(t, liisa.id, "factor_removed_by_admin")).map((e) => e.detail)).toEqual(["ylläpitäjä aino"]);
    expect((await again.call("GET", "/api/security/notices")).body.notices.some((n: { kind: string }) => n.kind === "factor_removed_by_admin")).toBe(true);

    // an admin's factor: not by the admin route, not by another admin, only by the owner with password and code
    const second = await t.admin.call("POST", "/api/users", { username: "toinen", displayName: "Toinen", role: "admin" });
    const other = t.client();
    await other.call("POST", "/api/auth/login", { username: "toinen", password: second.body.temporaryPassword });
    await other.call("POST", "/api/auth/password", { current: second.body.temporaryPassword, next: "toinen-uusi-salasana" });
    const { secret } = await enrol(t.admin);
    expect((await other.call("DELETE", `/api/users/${t.adminId}/factor`)).status).toBe(400);
    expect((await t.admin.call("DELETE", `/api/users/${t.adminId}/factor`)).status).toBe(400);
    expect((await t.admin.call("GET", "/api/security/factor")).body.enabled).toBe(true);
    expect((await t.admin.call("POST", "/api/security/factor/remove", { password: PASSWORD, code: totpCode(secret, STEP + 1) })).status).toBe(200);
  });

  it("deleting a member deletes the factor with them", async () => {
    const t = await setupApp();
    const liisa = await t.member("liisa");
    await enrol(liisa, STEP, "liisa-uusi-salasana");
    expect((await t.admin.call("DELETE", `/api/users/${liisa.id}`)).status).toBe(200);
    expect(await t.db.all("SELECT 1 FROM user_factor")).toHaveLength(0);
  });
});

describe("second factor: the server key", () => {
  it("a new app secret re-seals the factor secret under the same context", async () => {
    const t = await setupApp();
    const { secret } = await enrol(t.admin);
    const before = (await t.db.first<{ secret: string }>("SELECT secret FROM user_factor WHERE kind = 'totp'"))!.secret;
    const next = "another-secret-that-is-long-enough-0123456789";
    await resealAll(t.s, "test-secret-that-is-long-enough-0123456789", next);
    const after = (await t.db.first<{ secret: string }>("SELECT secret FROM user_factor WHERE kind = 'totp'"))!.secret;
    expect(after).not.toBe(before);
    expect(await (await SecretBox.fromSecret(next)).open(after, `factor:${t.adminId}`)).toBe(secret);
    await expect(resealAll(t.s, "test-secret-that-is-long-enough-0123456789", next)).rejects.toThrow(/second-factor/);
  });
});

const OLD_SECRET = "test-secret-that-is-long-enough-0123456789";
const NEW_SECRET = "another-secret-that-is-long-enough-0123456789";

/** Runs a command-line call and returns its status and what it printed. */
async function cli(t: Awaited<ReturnType<typeof setupApp>>, ...args: string[]) {
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((line) => void out.push(String(line)));
  const err = vi.spyOn(console, "error").mockImplementation((line) => void out.push(String(line)));
  try {
    return { status: await runCli(t.s, args), out: out.join("\n") };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

describe("second factor: enrolment asks for the password", () => {
  it("a stolen session alone cannot start or confirm; a wrong password counts and the right one passes", async () => {
    const t = await setupApp();
    expect((await t.admin.call("POST", "/api/security/factor/enrol", {})).status).toBe(400);
    const wrong = await t.admin.call("POST", "/api/security/factor/enrol", { password: "vaara-salasana-1" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("Salasana on väärä.");
    expect((await events(t, t.adminId, "login_fail")).map((e) => e.detail)).toEqual(["kaksivaiheinen kirjautuminen", "kaksivaiheinen kirjautuminen"]);

    // a started enrolment is not confirmed by the session alone, and the wrong password leaves it pending
    const started = await t.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD });
    expect(started.status).toBe(200);
    const code = totpCode(started.body.secret, STEP + 1);
    expect((await t.admin.call("POST", "/api/security/factor/confirm", { code })).status).toBe(400);
    expect((await t.admin.call("POST", "/api/security/factor/confirm", { password: "vaara-salasana-1", code })).status).toBe(400);
    expect(await t.db.all("SELECT 1 FROM user_factor")).toHaveLength(0);
    expect((await t.admin.call("POST", "/api/security/factor/confirm", { password: PASSWORD, code })).status).toBe(200);
  });

  it("wrong passwords at enrolment share the password throttle: the sixth try is refused even with the right password", async () => {
    const t = await setupApp();
    for (let i = 0; i < 5; i++) expect((await t.admin.call("POST", "/api/security/factor/enrol", { password: "vaara-salasana-1" })).status).toBe(400);
    const locked = await t.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.res.headers.get("retry-after")).toBeTruthy();
  });
});

describe("second factor: the command line removes it", () => {
  it("takes the factor of the only admin, ends their sessions and tells them; the next sign-in needs the password alone", async () => {
    const t = await setupApp();
    await enrol(t.admin);
    const done = await cli(t, "user", "remove-factor", "aino");
    expect(done.status).toBe(0);
    expect(done.out).toContain("signed them out");
    expect(await t.db.all("SELECT 1 FROM user_factor")).toHaveLength(0);
    expect((await t.admin.call("GET", "/api/meta")).status).toBe(401);
    expect((await events(t, t.adminId, "factor_removed_by_admin")).map((e) => e.detail)).toEqual(["komentorivi"]);
    const again = t.client();
    expect((await again.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD })).body.user.username).toBe("aino");
    expect((await again.call("GET", "/api/security/notices")).body.notices.some((n: { kind: string }) => n.kind === "factor_removed_by_admin")).toBe(true);
  });

  it("a user without a factor, or an unknown one, is refused and nobody is signed out", async () => {
    const t = await setupApp();
    expect((await cli(t, "user", "remove-factor", "aino")).status).toBe(1);
    expect((await cli(t, "user", "remove-factor", "ei-ole")).status).toBe(1);
    expect((await t.admin.call("GET", "/api/meta")).status).toBe(200);
    expect(await events(t, t.adminId, "factor_removed_by_admin")).toHaveLength(0);
  });
});

describe("second factor: removal by an admin ends the sessions", () => {
  it("ends the member sessions only, and the event naming the admin is in the member own list", async () => {
    const t = await setupApp();
    const liisa = await t.member("liisa");
    const matti = await t.member("matti");
    await enrol(liisa, STEP, "liisa-uusi-salasana");
    expect((await t.admin.call("DELETE", `/api/users/${liisa.id}/factor`)).status).toBe(200);
    expect((await liisa.call("GET", "/api/meta")).status).toBe(401);
    expect((await matti.call("GET", "/api/meta")).status).toBe(200);
    const again = t.client();
    await again.call("POST", "/api/auth/login", { username: "liisa", password: "liisa-uusi-salasana" });
    const list = (await again.call("GET", "/api/security/events?kind=factor_removed_by_admin")).body.events;
    expect(list.map((e: { username: string; detail: string }) => [e.username, e.detail])).toEqual([["liisa", "ylläpitäjä aino"]]);
  });
});

describe("second factor: turning it on and the sessions", () => {
  it("ends the user's other sessions and keeps the one that confirmed", async () => {
    const t = await setupApp();
    const other = t.client();
    await other.call("POST", "/api/auth/login", { username: "aino", password: PASSWORD });
    expect((await other.call("GET", "/api/meta")).status).toBe(200);
    const liisa = await t.member("liisa");
    await enrol(t.admin);
    expect((await other.call("GET", "/api/meta")).status).toBe(401);
    expect((await t.admin.call("GET", "/api/meta")).status).toBe(200);
    expect((await liisa.call("GET", "/api/meta")).status).toBe(200); // another user's session stays
  });

  it("a half session ends when the password is reset or changed, and not before", async () => {
    const t = await setupApp();
    const liisa = await t.member("liisa");
    const { secret } = await enrol(t.admin);
    const { secret: liisaSecret } = await enrol(liisa, STEP, "liisa-uusi-salasana");
    const halfOf = async (username: string, password: string) => {
      const c = t.client();
      await c.call("POST", "/api/auth/login", { username, password });
      return c;
    };

    const reset = await halfOf("aino", PASSWORD);
    await resetPassword(t.s, t.adminId);
    const gone = await reset.call("POST", "/api/auth/factor", { code: totpCode(secret, STEP + 1) });
    expect(gone.status).toBe(401);
    expect(gone.body.code).toBe("half_expired");
    expect(await t.db.all("SELECT 1 FROM sessions WHERE user_id = ?", [t.adminId])).toHaveLength(0);

    const changed = await halfOf("liisa", "liisa-uusi-salasana");
    expect((await liisa.call("POST", "/api/auth/password", { current: "liisa-uusi-salasana", next: "liisa-toinen-salasana" })).status).toBe(200);
    expect((await changed.call("POST", "/api/auth/factor", { code: totpCode(liisaSecret, STEP + 1) })).body.code).toBe("half_expired");
    // a sign-in made with the new password is a half session of its own and passes
    const fresh = await halfOf("liisa", "liisa-toinen-salasana");
    expect((await fresh.call("POST", "/api/auth/factor", { code: totpCode(liisaSecret, STEP + 1) })).status).toBe(200);
  });
});

describe("second factor: two confirms at once", () => {
  it("one wins with the codes and one factor_on event; the other gets 409 and no codes", async () => {
    const t = await setupApp();
    const started = await t.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD });
    const body = { password: PASSWORD, code: totpCode(started.body.secret, STEP + 1) };
    const both = await Promise.all([t.admin.call("POST", "/api/security/factor/confirm", body), t.admin.call("POST", "/api/security/factor/confirm", body)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = both.find((r) => r.status === 409)!;
    expect(loser.body.recoveryCodes).toBeUndefined();
    expect(both.find((r) => r.status === 200)!.body.recoveryCodes).toHaveLength(10);
    expect(await t.db.all("SELECT 1 FROM user_factor WHERE kind = 'recovery'")).toHaveLength(10);
    expect(await t.db.all("SELECT 1 FROM user_factor WHERE kind = 'totp'")).toHaveLength(1);
    expect(await events(t, t.adminId, "factor_on")).toHaveLength(1);
    // a confirm after the winner has finished is a 409 as well
    expect((await t.admin.call("POST", "/api/security/factor/confirm", body)).status).toBe(409);
  });
});

describe("second factor: a rotation of the app secret waits for its restart", () => {
  it("enrolment is refused with a 409 while the secret file is not the one running, and passes before and after", async () => {
    let stale = false;
    const t = await setupApp({}, undefined, { secretStale: () => stale });
    expect((await t.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD })).status).toBe(200);
    stale = true;
    const answer = await t.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD });
    expect(answer.status).toBe(409);
    expect(answer.body.error).toContain("salausavain on vaihdettu");
    // a rotation made after the start: the confirm is refused too, the pending secret stays for the restart
    stale = false;
    const started = await t.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD });
    stale = true;
    const code = totpCode(started.body.secret, STEP + 1);
    expect((await t.admin.call("POST", "/api/security/factor/confirm", { password: PASSWORD, code })).status).toBe(409);
    expect(await t.db.all("SELECT 1 FROM user_factor")).toHaveLength(0);
    stale = false;
    expect((await t.admin.call("POST", "/api/security/factor/confirm", { password: PASSWORD, code })).status).toBe(200);
  });

  it("stored values already sealed with the new secret (a rotation that committed) refuse it as well", async () => {
    const t = await setupApp();
    const liisa = await t.member("liisa");
    await enrol(liisa, STEP, "liisa-uusi-salasana");
    await resealAll(t.s, OLD_SECRET, NEW_SECRET); // the running app still holds the old secret
    expect((await t.admin.call("POST", "/api/security/factor/enrol", { password: PASSWORD })).status).toBe(409);
    expect(await t.db.all("SELECT 1 FROM user_factor WHERE kind = 'totp'")).toHaveLength(1);
  });
});

describe("second factor: the secret file against the running secret", () => {
  it("differs only when the file holds another secret; a missing file or no file is no rotation", () => {
    const file = join(scratchDir("secret-file"), "app_secret");
    writeFileSync(file, `${NEW_SECRET}\n`);
    expect(secretFileDiffers(file, OLD_SECRET)).toBe(true);
    expect(secretFileDiffers(file, NEW_SECRET)).toBe(false);
    expect(secretFileDiffers(`${file}.missing`, OLD_SECRET)).toBe(false);
    expect(secretFileDiffers(null, OLD_SECRET)).toBe(false);
    expect(secretFileDiffers(file, undefined)).toBe(false);
  });
});
