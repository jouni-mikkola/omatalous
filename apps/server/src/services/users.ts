/** Household members: first-run setup, adding members, passwords. */
import type { Role, User } from "../db/rows.ts";
export type { Role } from "../db/rows.ts";
import { USER_DATA_VERSION } from "../db/settings-repo.ts";
import { sha256, timingSafeEqual, utf8 } from "../security/encoding.ts";
import { generatePassword, hashPassword, passwordProblem, verifyPassword } from "../security/password.ts";
import { UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { randomToken } from "../platform/ids.ts";
import { revokeAllConnections } from "../connectors/registry.ts";
import { recordEvent } from "./security.ts";
import { TooManyAttempts, tooManyMessage } from "../platform/errors.ts";

/** Address and browser of the request behind an action, for the security event. */
export interface RequestInfo {
  ip: string | null;
  userAgent: string | null;
}

const USERNAME = /^[a-z0-9._-]{3,32}$/i;
const SETUP_KEY = "setup_code_hash";

/**
 * While no users exist, the first admin is created in the browser with a
 * one-time setup code. It is printed to the server log (or set with
 * SETUP_CODE), so only someone with access to the server can claim the instance.
 * Returns the code when a new one was generated, so the caller can log it.
 */
export async function ensureSetupCode(s: Services): Promise<string | null> {
  if ((await s.users.count()) > 0) {
    await s.settings.delete(SETUP_KEY);
    return null;
  }
  if (s.config.setupCode) return null;
  if (await s.settings.get(SETUP_KEY)) return null;
  const code = generatePassword();
  await s.settings.set(SETUP_KEY, await sha256(code));
  return code;
}

/**
 * A fresh setup code for the installer (`node dist/node.js setup-code`):
 * replaces any earlier one, only while no users exist.
 */
export async function issueSetupCode(s: Services): Promise<string | null> {
  if ((await s.users.count()) > 0) return null;
  if (s.config.setupCode) return s.config.setupCode;
  const code = generatePassword();
  await s.settings.set(SETUP_KEY, await sha256(code));
  return code;
}

export async function needsSetup(s: Services): Promise<boolean> {
  return (await s.users.count()) === 0;
}

async function setupCodeMatches(s: Services, code: string): Promise<boolean> {
  const given = utf8.encode(await sha256(code.trim()));
  if (s.config.setupCode) return timingSafeEqual(given, utf8.encode(await sha256(s.config.setupCode)));
  const stored = await s.settings.get(SETUP_KEY);
  return !!stored && timingSafeEqual(given, utf8.encode(stored));
}

export async function createFirstAdmin(s: Services, input: { code: string; username: string; displayName: string; password: string }): Promise<User> {
  if (!(await needsSetup(s))) throw new UserError("Sovellus on jo otettu käyttöön.");
  if (!(await setupCodeMatches(s, input.code))) throw new UserError("Väärä asennuskoodi. Uuden saa komennolla docker compose exec banking node dist/node.js setup-code");
  const username = input.username.trim();
  if (!USERNAME.test(username)) throw new UserError("Käyttäjätunnuksessa pitää olla 3–32 merkkiä (a–z, 0–9, . _ -).");
  const problem = passwordProblem(input.password);
  if (problem) throw new UserError(problem);
  const id = randomToken();
  // the empty-table check and the insert are one statement: two parallel setups cannot both create an admin
  const created = await s.users.createIfNoUsers({
    id,
    username,
    displayName: input.displayName.trim() || username,
    passwordHash: await hashPassword(input.password, s.config.passwordIterations),
  });
  if (!created) throw new UserError("Sovellus on jo otettu käyttöön.");
  await s.settings.delete(SETUP_KEY);
  return (await s.users.get(id))!;
}

/** Creates a user. Without a password a temporary one is generated and must be changed at first login. */
export async function createUser(
  s: Services,
  input: { username: string; displayName: string; role: Role; password?: string },
): Promise<{ user: User; temporaryPassword: string | null }> {
  const username = input.username.trim();
  if (!USERNAME.test(username)) throw new UserError("Käyttäjätunnuksessa pitää olla 3–32 merkkiä (a–z, 0–9, . _ -).");
  if (await s.users.findForLogin(username)) throw new UserError("Käyttäjätunnus on jo käytössä.");
  const temporary = input.password ? null : generatePassword();
  const password = input.password ?? temporary!;
  const problem = passwordProblem(password);
  if (problem) throw new UserError(problem);
  const id = randomToken();
  await s.users.create({
    id,
    username,
    displayName: input.displayName.trim() || username,
    passwordHash: await hashPassword(password, s.config.passwordIterations),
    role: input.role,
    mustChangePassword: !!temporary,
  });
  await recordEvent(s, { kind: "user_created", userId: id, detail: `${input.role}, ${username}` });
  return { user: (await s.users.get(id))!, temporaryPassword: temporary };
}

export async function changePassword(s: Services, user: User, current: string, next: string, keepSessionId: string, req: RequestInfo = { ip: null, userAgent: null }): Promise<void> {
  // the attempt is counted before the slow hash, so a burst of parallel guesses is counted too
  const attempt = s.passwordLimiter.consume(user.id);
  if (attempt.wait) {
    if (attempt.first) await recordEvent(s, { kind: "lockout", userId: user.id, ...req, detail: "salasanan vaihto" });
    throw new TooManyAttempts(tooManyMessage(attempt.wait), attempt.wait);
  }
  if (!s.hashGate.tryEnter()) {
    s.passwordLimiter.release(user.id);
    throw new TooManyAttempts("Palvelin on kiireinen. Yritä hetken päästä uudelleen.", 2);
  }
  let ok = false;
  try {
    const record = await s.users.findForLogin(user.username);
    ok = !!record && (await verifyPassword(current, record.passwordHash));
  } finally {
    s.hashGate.leave();
  }
  if (!ok) {
    await recordEvent(s, { kind: "login_fail", userId: user.id, ...req, detail: "salasanan vaihto" });
    throw new UserError("Nykyinen salasana on väärä.");
  }
  s.passwordLimiter.reset(user.id);
  const problem = passwordProblem(next);
  if (problem) throw new UserError(problem);
  if (current === next) throw new UserError("Uusi salasana ei voi olla sama kuin vanha.");
  await s.users.setPassword(user.id, await hashPassword(next, s.config.passwordIterations), false);
  await s.users.deleteSessionsOf(user.id, keepSessionId); // sign out other devices
  await recordEvent(s, { kind: "password_changed", userId: user.id, ...req });
}

/** `actor` is the admin who did it (null for the command line); the member sees a notice. */
export async function resetPassword(s: Services, userId: string, actor: { username: string } | null = null, req: RequestInfo = { ip: null, userAgent: null }): Promise<string> {
  if (!(await s.users.get(userId))) throw new UserError("Käyttäjää ei löydy.");
  const temporary = generatePassword();
  await s.users.setPassword(userId, await hashPassword(temporary, s.config.passwordIterations), true);
  await s.users.deleteSessionsOf(userId);
  await recordEvent(s, { kind: "password_reset_by_admin", userId, ...req, detail: actor ? `ylläpitäjä ${actor.username}` : "komentorivi", notify: true });
  return temporary;
}

export interface RemovalResult {
  /** Bank consents ended at Enable Banking. */
  revoked: number;
  /** Consents that could not be ended (already gone, or no key); they expire at the bank on their own. */
  failed: number;
}

/**
 * Removes a member and all of their data. Their bank consents are ended first, while their keys still
 * exist. Afterwards the database file is rewritten so the rows do not linger in free pages.
 */
export async function removeUser(s: Services, userId: string, by: string, req: RequestInfo = { ip: null, userAgent: null }): Promise<RemovalResult> {
  const target = await s.users.get(userId);
  if (!target) throw new UserError("Käyttäjää ei löydy.");
  const bank = await revokeAllConnections(s, userId);
  await s.users.delete(userId);
  // the instance version: every member's household view may have held this member's accounts
  await s.settings.bumpDataVersion();
  await s.settings.delete(`${USER_DATA_VERSION}${userId}`);
  try {
    await s.users.compact();
  } catch (err) {
    console.error("database compaction after member removal failed:", (err as Error).message);
  }
  await recordEvent(s, { kind: "user_deleted", ...req, detail: `${target.username} poistettu (${by})` });
  return bank;
}

export async function deleteUser(s: Services, actor: User, userId: string, req?: RequestInfo): Promise<RemovalResult> {
  if (actor.id === userId) throw new UserError("Et voi poistaa omaa tunnustasi.");
  const target = await s.users.get(userId);
  if (!target) throw new UserError("Käyttäjää ei löydy.");
  if (target.role === "admin" && (await s.users.countAdmins()) <= 1) throw new UserError("Viimeistä ylläpitäjää ei voi poistaa.");
  return removeUser(s, userId, actor.username, req);
}
