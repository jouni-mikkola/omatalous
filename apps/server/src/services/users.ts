/** Household members: first-run setup, adding members, passwords. */
import type { Role, User } from "../db/rows.ts";
export type { Role } from "../db/rows.ts";
import { USER_DATA_VERSION } from "../db/settings-repo.ts";
import { sha256, timingSafeEqual, utf8 } from "../security/encoding.ts";
import { generatePassword, hashPassword, needsRehash, type PasswordCost, passwordRefusal, pbkdf2Rounds, verifyPassword } from "../security/password.ts";
import { UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { randomToken } from "../platform/ids.ts";
import { revokeAllConnections } from "../connectors/registry.ts";
import { refuseAdminWithoutFactor } from "./remote-access.ts";
import { recordEvent } from "./security.ts";
import { hashBusy, tooMany } from "../platform/errors.ts";

/** Address and browser of the request behind an action, for the security event. */
export interface RequestInfo {
  ip: string | null;
  userAgent: string | null;
}

/** The Argon2id cost a new hash gets now: the admin's limits, read at each use. */
export const passwordCost = (s: Services): PasswordCost => ({ memoryKib: s.instance.limits.get("passwordMemoryKib"), passes: s.instance.limits.get("passwordPasses") });

/** A new hash, behind the same gate as a check: each running hash holds its memory, so only `hashSlots` run at once. */
async function hashed(s: Services, password: string): Promise<string> {
  if (!s.hashGate.tryEnter()) throw hashBusy();
  try {
    return await hashPassword(password, passwordCost(s));
  } finally {
    s.hashGate.leave();
  }
}

/**
 * After a correct password: a hash made by an earlier scheme or at another cost is rewritten as Argon2id at the cost now
 * set. The caller holds a hash slot. The write only lands while the stored hash is still the one that was checked. When
 * it was not (a password change, a reset or another sign-in got there first), the password is checked against what is
 * stored now, and any doubt refuses the sign-in. Returns the hash that is stored, or null when the sign-in must be
 * refused. A hash that cannot be made keeps the old one, which still works. (A password changed after a check of a hash
 * that needed no rewrite is not seen here: that window is as wide as the check itself.)
 */
export async function upgradePasswordHash(s: Services, record: { id: string; username: string; passwordHash: string }, password: string, req: RequestInfo): Promise<string | null> {
  const cost = passwordCost(s);
  const stored = record.passwordHash;
  if (!needsRehash(stored, cost)) return stored;
  let next: string;
  try {
    next = await hashPassword(password, cost);
  } catch (e) {
    console.error("password hash upgrade failed, the old hash stays", e instanceof Error ? e.message : e);
    return stored;
  }
  try {
    if (await s.users.replaceHash(record.id, stored, next)) {
      await recordEvent(s, { kind: "password_rehashed", userId: record.id, ...req, detail: pbkdf2Rounds(stored) !== null ? "PBKDF2:sta Argon2id:ksi" : "uusi kustannus" }).catch((e) => console.error("password_rehashed event not written", e instanceof Error ? e.message : e));
      return next;
    }
    const now = await s.users.findForLogin(record.username);
    return now && (await verifyPassword(password, now.passwordHash)) ? now.passwordHash : null;
  } catch (e) {
    console.error("password hash upgrade could not settle which hash is stored, sign-in refused", e instanceof Error ? e.message : e);
    return null;
  }
}

const USERNAME = /^[a-z0-9._-]{3,32}$/i;
const SETUP_KEY = "setup_code_hash";
/** When the code behind SETUP_KEY was made, as an ISO time. */
const SETUP_AT_KEY = "setup_code_at";
/** A generated setup code works this long: one left in a terminal log or a chat stops working. */
const SETUP_CODE_MS = 24 * 3_600_000;

/**
 * True when a generated code made at `at` no longer works. A hash without a time is from before 0.9.0 and counts
 * as expired, and so does a time more than a day ahead of the clock: the clock was wrong when the code was made.
 */
function setupCodeExpired(at: string | null, now: Date): boolean {
  const made = at ? Date.parse(at) : NaN;
  return !(Math.abs(now.getTime() - made) <= SETUP_CODE_MS);
}

async function newSetupCode(s: Services): Promise<string> {
  const code = generatePassword();
  // the hash first: until the time is written too, the new code has the old time, which can only refuse it
  await s.settings.set(SETUP_KEY, await sha256(code));
  await s.settings.set(SETUP_AT_KEY, s.now().toISOString());
  return code;
}

async function forgetSetupCode(s: Services): Promise<void> {
  await s.settings.delete(SETUP_KEY);
  await s.settings.delete(SETUP_AT_KEY);
}

/**
 * While no users exist, the first admin is created in the browser with a
 * one-time setup code. It is printed to the server log (or set with
 * SETUP_CODE), so only someone with access to the server can claim the instance.
 * A generated code works for 24 hours; one from SETUP_CODE never expires.
 * Returns the code when a new one was generated, so the caller can log it.
 *
 * `renewExpired` is for the start of the server: an expired code, or a hash without a time, is replaced the way a
 * missing one is. A request leaves an expired code in place, so that the person who types it is told it expired.
 */
export async function ensureSetupCode(s: Services, opts: { renewExpired?: boolean } = {}): Promise<string | null> {
  if ((await s.users.count()) > 0) {
    await forgetSetupCode(s);
    return null;
  }
  if (s.config.setupCode) return null;
  if (await s.settings.get(SETUP_KEY)) {
    if (!opts.renewExpired || !setupCodeExpired(await s.settings.get(SETUP_AT_KEY), s.now())) return null;
  }
  return newSetupCode(s);
}

/**
 * A fresh setup code for the installer (`node dist/node.js setup-code`):
 * replaces any earlier one, only while no users exist.
 */
export async function issueSetupCode(s: Services): Promise<string | null> {
  if ((await s.users.count()) > 0) return null;
  if (s.config.setupCode) return s.config.setupCode;
  return newSetupCode(s);
}

export async function needsSetup(s: Services): Promise<boolean> {
  return (await s.users.count()) === 0;
}

async function checkSetupCode(s: Services, code: string): Promise<"ok" | "wrong" | "expired"> {
  const given = utf8.encode(await sha256(code.trim()));
  // a code from .env never expires: the person who wrote it there chose it
  if (s.config.setupCode) return timingSafeEqual(given, utf8.encode(await sha256(s.config.setupCode))) ? "ok" : "wrong";
  // the time is read before the hash: `setup-code` in another process writes the hash first, so an old hash is
  // never checked against a new time
  const at = await s.settings.get(SETUP_AT_KEY);
  const stored = await s.settings.get(SETUP_KEY);
  if (!stored) return "wrong";
  // whatever was typed: no code works now, and saying so tells nothing about the code
  if (setupCodeExpired(at, s.now())) return "expired";
  return timingSafeEqual(given, utf8.encode(stored)) ? "ok" : "wrong";
}

export async function createFirstAdmin(s: Services, input: { code: string; username: string; displayName: string; password: string }): Promise<User> {
  if (!(await needsSetup(s))) throw UserError.of("auth.setup_done");
  const check = await checkSetupCode(s, input.code);
  // both sentences name the command, not install.sh: a re-run of install.sh shows no code when it comes from SETUP_CODE
  if (check === "expired") throw UserError.of("auth.setup_code_expired");
  if (check === "wrong") throw UserError.of("auth.setup_code_wrong");
  const username = input.username.trim();
  if (!USERNAME.test(username)) throw UserError.of("auth.username_shape");
  const refusal = passwordRefusal(input.password);
  if (refusal) throw refusal;
  const id = randomToken();
  // the empty-table check and the insert are one statement: two parallel setups cannot both create an admin
  const created = await s.users.createIfNoUsers({
    id,
    username,
    displayName: input.displayName.trim() || username,
    passwordHash: await hashed(s, input.password),
  });
  if (!created) throw UserError.of("auth.setup_done");
  await forgetSetupCode(s);
  return (await s.users.get(id))!;
}

/** Creates a user. Without a password a temporary one is generated and must be changed at first login. */
export async function createUser(
  s: Services,
  input: { username: string; displayName: string; role: Role; password?: string },
  actor: { username: string } | null = null,
  req: RequestInfo = { ip: null, userAgent: null },
): Promise<{ user: User; temporaryPassword: string | null }> {
  const username = input.username.trim();
  if (!USERNAME.test(username)) throw UserError.of("auth.username_shape");
  if (input.role === "admin") await refuseAdminWithoutFactor(s, null);
  if (await s.users.findForLogin(username)) throw UserError.of("auth.username_taken");
  const temporary = input.password ? null : generatePassword();
  const password = input.password ?? temporary!;
  const refusal = passwordRefusal(password);
  if (refusal) throw refusal;
  const id = randomToken();
  await s.users.create({
    id,
    username,
    displayName: input.displayName.trim() || username,
    passwordHash: await hashed(s, password),
    role: input.role,
    mustChangePassword: !!temporary,
  });
  await recordEvent(s, { kind: "user_created", userId: id, ...req, detail: `${input.role}, ${username}, ${actor ? `ylläpitäjä ${actor.username}` : "komentorivi"}` });
  return { user: (await s.users.get(id))!, temporaryPassword: temporary };
}

/**
 * The password typed again for an action that needs it (a change, taking the second factor away). Counted per user
 * before the slow hash, so a burst of parallel guesses is counted too. `what` names the action in the event and the
 * lockout; `wrong` is the catalogue code for a wrong password.
 */
export async function confirmPassword(s: Services, user: { id: string; username: string }, password: string, req: RequestInfo, what: string, wrong: "auth.password_wrong" | "auth.current_password_wrong"): Promise<void> {
  const attempt = s.passwordLimiter.consume(user.id);
  if (attempt.wait) {
    if (attempt.first) await recordEvent(s, { kind: "lockout", userId: user.id, ...req, detail: what });
    throw tooMany(attempt.wait);
  }
  if (!s.hashGate.tryEnter()) {
    s.passwordLimiter.release(user.id);
    throw hashBusy();
  }
  let ok = false;
  try {
    const record = await s.users.findForLogin(user.username);
    ok = !!record && (await verifyPassword(password, record.passwordHash));
  } finally {
    s.hashGate.leave();
  }
  if (!ok) {
    await recordEvent(s, { kind: "login_fail", userId: user.id, ...req, detail: what });
    throw UserError.of(wrong);
  }
  s.passwordLimiter.reset(user.id);
}

export async function changePassword(s: Services, user: User, current: string, next: string, keepSessionId: string, req: RequestInfo = { ip: null, userAgent: null }): Promise<void> {
  if (user.mustChangePassword) throw UserError.of("auth.use_first_password");
  await confirmPassword(s, user, current, req, "salasanan vaihto", "auth.current_password_wrong");
  const refusal = passwordRefusal(next);
  if (refusal) throw refusal;
  if (current === next) throw UserError.of("auth.password_unchanged");
  await s.users.setPassword(user.id, await hashed(s, next), false);
  await s.users.deleteSessionsOf(user.id, keepSessionId); // sign out other devices
  await recordEvent(s, { kind: "password_changed", userId: user.id, ...req });
}

/** How long after the sign-in with a temporary password the first password is still taken. */
const FIRST_PASSWORD_MINUTES = 10;

/**
 * The first password of a member who signed in with a temporary one. The sign-in just proved the temporary password,
 * so only the new one is asked, and only in the session that sign-in made and within ten minutes of it.
 */
export async function setFirstPassword(s: Services, user: User, next: string, sessionId: string, req: RequestInfo = { ip: null, userAgent: null }): Promise<void> {
  if (!user.mustChangePassword) throw UserError.of("auth.first_password_not_due");
  const session = await s.users.getSession(sessionId);
  if (!session || s.now().getTime() - new Date(session.createdAt).getTime() > FIRST_PASSWORD_MINUTES * 60_000) {
    await s.users.deleteSession(sessionId);
    throw UserError.of("auth.first_password_expired");
  }
  const refusal = passwordRefusal(next);
  if (refusal) throw refusal;
  // the temporary password is not a password of their own; the check is a hash, so it runs behind the gate
  if (!s.hashGate.tryEnter()) throw hashBusy();
  let same = false;
  try {
    same = await verifyPassword(next, (await s.users.findForLogin(user.username))?.passwordHash ?? "");
  } finally {
    s.hashGate.leave();
  }
  if (same) throw UserError.of("auth.password_unchanged");
  await s.users.setPassword(user.id, await hashed(s, next), false);
  await s.users.deleteSessionsOf(user.id, sessionId);
  await recordEvent(s, { kind: "password_changed", userId: user.id, ...req, detail: "ensimmäinen salasana" });
}

/** `actor` is the admin who did it (null for the command line); the member sees a notice. */
export async function resetPassword(s: Services, userId: string, actor: { username: string } | null = null, req: RequestInfo = { ip: null, userAgent: null }): Promise<string> {
  if (!(await s.users.get(userId))) throw UserError.of("user.missing");
  const temporary = generatePassword();
  await s.users.setPassword(userId, await hashed(s, temporary), true);
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
  if (!target) throw UserError.of("user.missing");
  const bank = await revokeAllConnections(s, userId);
  // the member's rows of who uses an account go with them, and their weight stays with the others as a part of the holders who are no user
  await s.household.removeMember(userId);
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

/** A new display name or role. A role change is a security event: it gives or takes the admin's rights. */
export async function updateUser(s: Services, actor: User, userId: string, input: { displayName?: string; role?: Role }, req: RequestInfo): Promise<void> {
  const before = await s.users.get(userId);
  if (!before) throw UserError.of("user.missing");
  if (input.role === "member" && before.role === "admin" && userId === actor.id && (await s.users.countAdmins()) <= 1) {
    throw UserError.of("user.last_admin_role");
  }
  if (input.role === "admin" && before.role !== "admin") await refuseAdminWithoutFactor(s, userId);
  await s.users.update(userId, input);
  if (input.role && input.role !== before.role) {
    await recordEvent(s, { kind: "role_changed", userId, ...req, detail: `${before.role} -> ${input.role}, ylläpitäjä ${actor.username}` });
  }
}

export async function deleteUser(s: Services, actor: User, userId: string, req?: RequestInfo): Promise<RemovalResult> {
  if (actor.id === userId) throw UserError.of("user.delete_self");
  const target = await s.users.get(userId);
  if (!target) throw UserError.of("user.missing");
  if (target.role === "admin" && (await s.users.countAdmins()) <= 1) throw UserError.of("user.delete_last_admin");
  return removeUser(s, userId, actor.username, req);
}
