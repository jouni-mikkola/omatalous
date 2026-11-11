/** Login, logout, first-run setup and own password. */
import { Hono } from "hono";
import { clientIp } from "../auth/middleware.ts";
import { endHalfSession, endSession, readHalfSession, startHalfSession, startSession } from "../auth/session.ts";
import { verifyUniform } from "../security/password.ts";
import { addressKey } from "../security/rate-limit.ts";
import { coded, tooMany, tooManyBody, UserError } from "../platform/errors.ts";
import { recordEvent, recordLogin } from "../services/security.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { passkeyChallenge, relyingParty, takePasskey } from "../services/passkeys.ts";
import { takeCode } from "../services/second-factor.ts";
import { changePassword, createFirstAdmin, ensureSetupCode, needsSetup, passwordCost, setFirstPassword, upgradePasswordHash } from "../services/users.ts";
import { strictObject } from "../platform/validate.ts";
import { body, optionalString, requestInfo } from "./shared.ts";

/** A name typed at login goes in the event log only if it has the shape of a user name: a password typed in the wrong field must not stay 90 days. */
const shown = (typed: string) => (/^[a-z0-9._-]{3,32}$/i.test(typed.trim()) ? typed.trim() : "(ei käyttäjänimen muotoinen)");

export function authRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.get("/state", async (c) => {
    const setup = await needsSetup(s);
    if (setup) {
      const code = await ensureSetupCode(s);
      if (code) console.log(`\n  Setup code for creating the first user: ${code}\n`);
    }
    const user = c.get("user") ?? null;
    // the zone the browser reads timestamps in: the instance's, not the device's
    return c.json({ needsSetup: setup, user, timezone: s.instance.current.timezone });
  });

  app.post("/setup", async (c) => {
    // the code is the only thing between a stranger and an admin account: guesses are counted before they are checked
    const ip = clientIp(c, s);
    const attempt = s.setupLimiter.consume(addressKey(ip));
    if (attempt.wait) throw tooMany(attempt.wait);
    const raw = strictObject(await body(c), ["code", "username", "displayName", "password", "confirm"] as const);
    const input = {
      code: optionalString(raw.code, 100) ?? "",
      username: optionalString(raw.username, 64) ?? "",
      displayName: optionalString(raw.displayName, 80) ?? "",
      password: optionalString(raw.password, 1024) ?? "",
    };
    const user = await createFirstAdmin(s, input);
    await recordEvent(s, { kind: "user_created", userId: user.id, ip, userAgent: c.req.header("user-agent") ?? null, detail: `admin, ${user.username}` });
    await recordLogin(s, user.id, ip, c.req.header("user-agent") ?? null);
    await startSession(c, s, user.id);
    return c.json({ user });
  });

  app.post("/login", async (c) => {
    const input = strictObject(await body(c), ["username", "password"] as const);
    const username = typeof input.username === "string" ? input.username : "";
    const password = typeof input.password === "string" ? input.password : "";
    const limits = s.loginLimiter;
    const ip = clientIp(c, s);
    // the limits count an IPv6 client by its /64, the events record the address itself
    const ipKey = addressKey(ip);
    const userAgent = c.req.header("user-agent") ?? null;
    const refuse = (wait: number) => c.json(tooManyBody(wait), 429, { "Retry-After": String(wait) });
    // a login succeeded from this address lately. It changes one thing: when a limiter below is full of locked
    // keys and refuses every new key, this attempt is counted in that limiter's spare, under the same limit.
    const remembered = limits.remembered.has(ipKey);
    // every attempt is counted before the slow password hash runs: parallel guesses cannot slip past a
    // check that only looks at earlier failures. A successful login gives its attempt back.
    const ipTry = limits.ip.consume(ipKey, remembered);
    if (ipTry.wait) {
      if (ipTry.first) await recordEvent(s, { kind: "lockout", ip, userAgent, detail: "osoite" });
      return refuse(ipTry.wait);
    }
    // usernames are at most 32 characters: anything longer is not worth a limiter entry or a hash
    if (username.length > 64 || password.length > 1024) return c.json(coded("auth.bad_login"), 401);
    // per user name and address: a stranger's guesses at "aino" cannot lock Aino out from her own address
    const name = username.trim().toLowerCase();
    const userKey = `${ipKey}|${name}`;
    const lockout = async (detail: string) => {
      const known = await s.users.findForLogin(username);
      await recordEvent(s, { kind: "lockout", userId: known?.id ?? null, ip, userAgent, detail });
    };
    const userTry = limits.user.consume(userKey, remembered);
    if (userTry.wait) {
      limits.ip.release(ipKey);
      if (userTry.first) await lockout(shown(username));
      return refuse(userTry.wait);
    }
    const nameTry = limits.name.consume(name, remembered);
    if (nameTry.wait) {
      limits.ip.release(ipKey);
      limits.user.release(userKey);
      if (nameTry.first) await lockout(`${shown(username)}, kaikista osoitteista`);
      return refuse(nameTry.wait);
    }
    // at most a few hashes at once: the rest would only queue up behind the thread pool
    if (!s.hashGate.tryEnter()) {
      limits.ip.release(ipKey);
      limits.user.release(userKey);
      limits.name.release(name);
      return c.json(coded("auth.busy"), 429, { "Retry-After": "2" });
    }
    let record: Awaited<ReturnType<typeof s.users.findForLogin>>;
    let ok = false;
    try {
      record = await s.users.findForLogin(username);
      // verify against a dummy hash for unknown users, so timing does not reveal valid usernames
      ok = await verifyUniform(password, record?.passwordHash ?? null, passwordCost(s), await s.users.legacyRounds());
      // the slot is still held: the rewrite of an older hash costs one more hash
      if (record && ok) {
        const stored = await upgradePasswordHash(s, record, password, { ip, userAgent });
        if (stored === null) ok = false;
        else record.passwordHash = stored;
      }
    } finally {
      s.hashGate.leave();
    }
    if (!record || !ok) {
      await recordEvent(s, { kind: "login_fail", userId: record?.id ?? null, ip, userAgent, detail: shown(username) });
      return c.json(coded("auth.bad_login"), 401);
    }
    limits.user.reset(userKey);
    limits.ip.release(ipKey);
    // given back, not cleared: a correct password must not refill a stranger's guesses at the name
    limits.name.release(name);
    // with a second factor the password is half of it: no session, no remembered address and no login record until the code
    if (await s.factors.hasAny(record.id)) {
      await startHalfSession(c, s, record.id, record.passwordHash);
      // what the second step may offer: a code (authenticator app or recovery code) and a passkey the address allows
      const rp = relyingParty(s, { origin: c.req.header("origin"), host: c.req.header("host") });
      const passkey = rp.usable && rp.here && (await s.factors.passkeys(record.id)).some((p) => p.rpId === rp.id);
      return c.json({ needsFactor: true, passkey, codes: (await s.factors.hasTotp(record.id)) || (await s.factors.recoveryLeft(record.id)) > 0 });
    }
    // the only place an address is remembered: after a correct password
    limits.remembered.add(ipKey);
    await recordLogin(s, record.id, ip, userAgent);
    await startSession(c, s, record.id);
    const { passwordHash: _hash, ...user } = record;
    return c.json({ user });
  });

  /** The second half of a sign-in: a code from the app or a recovery code, sent with the cookie the password step set. */
  app.post("/factor", async (c) => {
    const raw = strictObject(await body(c), ["code"] as const);
    const code = optionalString(raw.code, 64) ?? "";
    const user = await readHalfSession(c, s);
    if (!user) return c.json({ ...coded("auth.half_expired"), code: "half_expired" }, 401);
    const req = requestInfo(c, s);
    if (!(await takeCode(s, user, code, req))) return c.json(coded("auth.bad_code"), 401);
    s.loginLimiter.remembered.add(addressKey(req.ip ?? "local"));
    await recordLogin(s, user.id, req.ip ?? "local", req.userAgent);
    await startSession(c, s, user.id);
    await endHalfSession(c, s);
    return c.json({ user });
  });

  /** The options for the passkey of a sign-in, for the half session the password step set. */
  app.post("/passkey/options", async (c) => {
    strictObject(await body(c), [] as const);
    const user = await readHalfSession(c, s);
    if (!user) return c.json({ ...coded("auth.half_expired"), code: "half_expired" }, 401);
    return c.json(await passkeyChallenge(s, user, { origin: c.req.header("origin"), host: c.req.header("host") }));
  });

  /** The device's answer to those options: the other way to finish the sign-in the code step finishes. */
  app.post("/passkey", async (c) => {
    const raw = strictObject(await body(c), ["response"] as const);
    const user = await readHalfSession(c, s);
    if (!user) return c.json({ ...coded("auth.half_expired"), code: "half_expired" }, 401);
    const req = requestInfo(c, s);
    if (!(await takePasskey(s, user, raw.response, req))) return c.json(coded("passkey.sign_in_failed"), 401);
    s.loginLimiter.remembered.add(addressKey(req.ip ?? "local"));
    await recordLogin(s, user.id, req.ip ?? "local", req.userAgent);
    await startSession(c, s, user.id);
    await endHalfSession(c, s);
    return c.json({ user });
  });

  app.post("/logout", async (c) => {
    const sessionId = c.get("sessionId");
    if (sessionId) await endSession(c, s, sessionId);
    await endHalfSession(c, s);
    return c.json({ ok: true });
  });

  app.post("/password", async (c) => {
    const user = c.get("user");
    if (!user) return c.json(coded("auth.login_required"), 401);
    const raw = strictObject(await body(c), ["current", "next"] as const);
    const current = optionalString(raw.current, 1024) ?? "";
    const next = optionalString(raw.next, 1024) ?? "";
    if (!next) throw UserError.of("auth.new_password_missing");
    await changePassword(s, user, current, next, c.get("sessionId"), requestInfo(c, s));
    return c.json({ ok: true });
  });

  app.post("/first-password", async (c) => {
    const user = c.get("user");
    if (!user) return c.json(coded("auth.login_required"), 401);
    const raw = strictObject(await body(c), ["next"] as const);
    const next = optionalString(raw.next, 1024) ?? "";
    if (!next) throw UserError.of("auth.new_password_missing");
    await setFirstPassword(s, user, next, c.get("sessionId"), requestInfo(c, s));
    return c.json({ ok: true });
  });

  return app;
}
