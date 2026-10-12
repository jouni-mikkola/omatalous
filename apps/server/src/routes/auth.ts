/** Login, logout, first-run setup and own password. */
import { Hono } from "hono";
import { clientIp } from "../auth/middleware.ts";
import { endSession, startSession } from "../auth/session.ts";
import { DUMMY_HASH, verifyPassword } from "../security/password.ts";
import { addressKey } from "../security/rate-limit.ts";
import { TooManyAttempts, tooManyMessage, UserError } from "../platform/errors.ts";
import { recordEvent, recordLogin } from "../services/security.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { changePassword, createFirstAdmin, ensureSetupCode, needsSetup } from "../services/users.ts";
import { strictObject } from "../platform/validate.ts";
import { body, optionalString } from "./shared.ts";

export function authRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.get("/state", async (c) => {
    const setup = await needsSetup(s);
    if (setup) {
      const code = await ensureSetupCode(s);
      if (code) console.log(`\n  Setup code for creating the first user: ${code}\n`);
    }
    const user = c.get("user") ?? null;
    return c.json({ needsSetup: setup, user });
  });

  app.post("/setup", async (c) => {
    // the code is the only thing between a stranger and an admin account: guesses are counted before they are checked
    const ip = clientIp(c, s);
    const attempt = s.setupLimiter.consume(addressKey(ip));
    if (attempt.wait) throw new TooManyAttempts(tooManyMessage(attempt.wait), attempt.wait);
    const raw = strictObject(await body(c), ["code", "username", "displayName", "password", "confirm"] as const);
    const input = {
      code: optionalString(raw.code, 100) ?? "",
      username: optionalString(raw.username, 64) ?? "",
      displayName: optionalString(raw.displayName, 80) ?? "",
      password: optionalString(raw.password, 1024) ?? "",
    };
    const user = await createFirstAdmin(s, input);
    await recordEvent(s, { kind: "user_created", userId: user.id, ip, detail: `admin, ${user.username}` });
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
    const refuse = (wait: number) => c.json({ error: tooManyMessage(wait) }, 429, { "Retry-After": String(wait) });
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
    if (username.length > 64 || password.length > 1024) return c.json({ error: "Väärä käyttäjätunnus tai salasana." }, 401);
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
      if (userTry.first) await lockout(username.trim());
      return refuse(userTry.wait);
    }
    const nameTry = limits.name.consume(name, remembered);
    if (nameTry.wait) {
      limits.ip.release(ipKey);
      limits.user.release(userKey);
      if (nameTry.first) await lockout(`${username.trim()}, kaikista osoitteista`);
      return refuse(nameTry.wait);
    }
    // at most a few hashes at once: the rest would only queue up behind the thread pool
    if (!s.hashGate.tryEnter()) {
      limits.ip.release(ipKey);
      limits.user.release(userKey);
      limits.name.release(name);
      return c.json({ error: "Palvelin on kiireinen. Yritä hetken päästä uudelleen." }, 429, { "Retry-After": "2" });
    }
    let record: Awaited<ReturnType<typeof s.users.findForLogin>>;
    let ok = false;
    try {
      record = await s.users.findForLogin(username);
      // verify against a dummy hash for unknown users, so timing does not reveal valid usernames
      ok = await verifyPassword(password, record?.passwordHash ?? DUMMY_HASH);
    } finally {
      s.hashGate.leave();
    }
    if (!record || !ok) {
      await recordEvent(s, { kind: "login_fail", userId: record?.id ?? null, ip, userAgent, detail: username.trim() });
      return c.json({ error: "Väärä käyttäjätunnus tai salasana." }, 401);
    }
    limits.user.reset(userKey);
    limits.ip.release(ipKey);
    // given back, not cleared: a correct password must not refill a stranger's guesses at the name
    limits.name.release(name);
    // the only place an address is remembered: after a correct password
    limits.remembered.add(ipKey);
    await recordLogin(s, record.id, ip, userAgent);
    await startSession(c, s, record.id);
    const { passwordHash: _hash, ...user } = record;
    return c.json({ user });
  });

  app.post("/logout", async (c) => {
    const sessionId = c.get("sessionId");
    if (sessionId) await endSession(c, s, sessionId);
    return c.json({ ok: true });
  });

  app.post("/password", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Kirjaudu sisään." }, 401);
    const raw = strictObject(await body(c), ["current", "next"] as const);
    const current = optionalString(raw.current, 1024) ?? "";
    const next = optionalString(raw.next, 1024) ?? "";
    if (!next) throw new UserError("Anna uusi salasana.");
    await changePassword(s, user, current, next, c.get("sessionId"), { ip: clientIp(c, s), userAgent: c.req.header("user-agent") ?? null });
    return c.json({ ok: true });
  });

  return app;
}
