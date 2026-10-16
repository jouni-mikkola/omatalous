/**
 * The second sign-in factor: an authenticator app (TOTP, security/totp.ts) and ten recovery codes. The secret is
 * sealed with the server's key like the bank keys; a recovery code is stored only as a hash. Every code typed, at
 * sign-in, at enrolment and when removing, counts in one throttle (factorLimiter) and fails into the same events.
 */
import { timingSafeEqual } from "node:crypto";
import { HttpUserError, TooManyAttempts, tooManyMessage, UserError } from "../platform/errors.ts";
import { randomBytes, sha256 } from "../security/encoding.ts";
import { addressKey } from "../security/rate-limit.ts";
import { newSecret, otpauthUri, stepOf, totpCode } from "../security/totp.ts";
import type { Services } from "./context.ts";
import { databaseOpensWith } from "./secret-rotation.ts";
import { recordEvent } from "./security.ts";
import { confirmPassword, type RequestInfo } from "./users.ts";

const RECOVERY_COUNT = 10;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_SHAPE = /^[A-HJ-NP-Z2-9]{10}$/;
const WRONG_CODE = "Koodi on väärä.";
const WRONG_PASSWORD = "Salasana on väärä.";
/** What a pending enrolment holds while one confirm is storing it, so a second confirm at the same moment finds it taken. */
const CLAIMED = "";

const sealContext = (userId: string) => `factor:${userId}`;
const recoveryHash = (userId: string, code: string) => sha256(`recovery:${userId}:${code}`);

/** Ten codes as the user is shown them, `XXXXX-XXXXX`; 50 random bits each. */
function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const chars = Array.from(randomBytes(10), (b) => RECOVERY_ALPHABET[b & 31]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/**
 * The step a code belongs to, looking one step back and one ahead of the clock (a phone a few seconds off), and only
 * a step above `lastStep`: a code used once, or an older one, is not taken again. Null when none fits.
 */
function matchStep(secret: string, code: string, nowMs: number, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code);
  let found: number | null = null;
  // all three are compared whatever the first one says, so the time taken does not tell which step was near
  for (const step of [stepOf(nowMs) - 1, stepOf(nowMs), stepOf(nowMs) + 1]) {
    const same = timingSafeEqual(given, Buffer.from(totpCode(secret, step)));
    if (same && (lastStep === null || step > lastStep)) found = step;
  }
  return found;
}

const normalRecovery = (code: string) => code.toUpperCase().replace(/[\s-]/g, "");

export async function factorStatus(s: Services, userId: string): Promise<{ enabled: boolean; since: string | null; lastUsedAt: string | null; recoveryLeft: number }> {
  const factor = await s.factors.totp(userId);
  return { enabled: !!factor, since: factor?.createdAt ?? null, lastUsedAt: factor?.lastUsedAt ?? null, recoveryLeft: factor ? await s.factors.recoveryLeft(userId) : 0 };
}

/**
 * Counts the try before it is made (parallel guesses cannot slip past), per address and user and per user from
 * every address, and gives it back when it succeeds. A wrong code is a `login_fail` event like a wrong password.
 */
async function throttled<T>(s: Services, user: { id: string; username: string }, req: RequestInfo, attempt: () => Promise<T | null>): Promise<T | null> {
  const userKey = `${addressKey(req.ip ?? "local")}|${user.id}`;
  const refuse = async (wait: number, first: boolean): Promise<never> => {
    if (first) await recordEvent(s, { kind: "lockout", userId: user.id, ...req, detail: "koodi" });
    throw new TooManyAttempts(tooManyMessage(wait), wait);
  };
  const byUser = s.factorLimiter.user.consume(userKey);
  if (byUser.wait) return refuse(byUser.wait, byUser.first);
  const byName = s.factorLimiter.name.consume(user.id);
  if (byName.wait) {
    s.factorLimiter.user.release(userKey);
    return refuse(byName.wait, byName.first);
  }
  const result = await attempt();
  if (result === null) {
    await recordEvent(s, { kind: "login_fail", userId: user.id, ...req, detail: `koodi, ${user.username}` });
    return null;
  }
  s.factorLimiter.user.reset(userKey);
  s.factorLimiter.name.release(user.id);
  return result;
}

async function sealedBox(s: Services) {
  const box = await s.secretBox();
  if (!box) throw new UserError("Kaksivaiheista kirjautumista ei voi käyttää, koska palvelimella ei ole salausavainta.");
  return box;
}

/** What a code typed for a user is: an authenticator code of a step not used yet, or one of the unused recovery codes. */
async function verifyCode(s: Services, user: { id: string }, input: string): Promise<"totp" | "recovery" | null> {
  const code = input.replace(/\s/g, "");
  if (/^\d{6}$/.test(code)) {
    const factor = await s.factors.totp(user.id);
    if (!factor) return null;
    let secret: string;
    try {
      secret = await (await sealedBox(s)).open(factor.sealed, sealContext(user.id));
    } catch {
      console.error("second factor secret cannot be opened with the current app secret");
      return null;
    }
    const step = matchStep(secret, code, s.now().getTime(), factor.lastStep);
    return step !== null && (await s.factors.useStep(factor.id, step, s.now().toISOString())) ? "totp" : null;
  }
  const recovery = normalRecovery(input);
  return RECOVERY_SHAPE.test(recovery) && (await s.factors.useRecovery(user.id, await recoveryHash(user.id, recovery))) ? "recovery" : null;
}

/**
 * Checks a code of a user who has the factor. Returns which kind it was, or null for a wrong one; throws
 * TooManyAttempts when the throttle is full. A recovery code that signs someone in is told to its owner.
 */
export async function takeCode(s: Services, user: { id: string; username: string }, input: string, req: RequestInfo): Promise<"totp" | "recovery" | null> {
  const kind = await throttled(s, user, req, () => verifyCode(s, user, input));
  if (kind === "recovery") await recordEvent(s, { kind: "recovery_code_used", userId: user.id, ...req, notify: true });
  return kind;
}

/**
 * A `secret rotate` waits for its restart: a secret sealed now is sealed with the key that is gone after it, and could
 * not be opened again (a 409). Both the secret file and the stored values are looked at: the file says a rotation was
 * made, the values say one committed and stopped before the file was replaced.
 */
async function keyIsCurrent(s: Services): Promise<void> {
  const secret = s.config.appSecret;
  if (s.secretStale() || (secret && !(await databaseOpensWith(s, secret)))) {
    throw new HttpUserError("Palvelimen salausavain on vaihdettu. Käynnistä sovellus uudelleen ja aloita käyttöönotto sen jälkeen.", 409);
  }
}

/** Step 1 of enrolment: the password again, then a new secret kept in memory for ten minutes until a code from the app confirms it. */
export async function startEnrol(s: Services, user: { id: string; username: string }, password: string, req: RequestInfo): Promise<{ secret: string; uri: string }> {
  await confirmPassword(s, user, password, req, "kaksivaiheinen kirjautuminen", WRONG_PASSWORD);
  if (await s.factors.hasTotp(user.id)) throw new UserError("Kaksivaiheinen kirjautuminen on jo käytössä.");
  await sealedBox(s);
  await keyIsCurrent(s);
  const secret = newSecret();
  s.factorEnrolments.set(user.id, secret, s.now().getTime());
  return { secret, uri: otpauthUri(user.username, secret) };
}

/**
 * Step 2: the password again and one valid code store the factor and make the recovery codes, shown this once. Of two
 * confirms at the same moment one wins: the pending secret is claimed in one synchronous step, the other gets a 409 and no
 * codes. The user's other sessions end, the one that did this stays.
 */
export async function confirmEnrol(s: Services, user: { id: string; username: string }, password: string, input: string, keepSessionId: string | undefined, req: RequestInfo): Promise<string[]> {
  await confirmPassword(s, user, password, req, "kaksivaiheinen kirjautuminen", WRONG_PASSWORD);
  const alreadyOn = () => new HttpUserError("Kaksivaiheinen kirjautuminen on jo käytössä.", 409);
  if (await s.factors.hasTotp(user.id)) throw alreadyOn();
  const secret = s.factorEnrolments.get(user.id, s.now().getTime());
  if (secret === undefined) throw new UserError("Aloita kaksivaiheisen kirjautumisen käyttöönotto alusta.");
  if (secret === CLAIMED) throw alreadyOn();
  await keyIsCurrent(s);
  const step = await throttled(s, user, req, async () => matchStep(secret, input.replace(/\s/g, ""), s.now().getTime(), null));
  if (step === null) throw new UserError(WRONG_CODE);
  const pending = s.factorEnrolments.get(user.id, s.now().getTime());
  if (pending !== secret) {
    if (pending === CLAIMED || (await s.factors.hasTotp(user.id))) throw alreadyOn();
    throw new HttpUserError("Aloita kaksivaiheisen kirjautumisen käyttöönotto alusta.", 409);
  }
  s.factorEnrolments.set(user.id, CLAIMED, s.now().getTime()); // the claim: nothing is awaited between the check above and here
  const codes = newRecoveryCodes();
  try {
    const sealed = await (await sealedBox(s)).seal(secret, sealContext(user.id));
    await s.factors.enable(user.id, sealed, step, await Promise.all(codes.map((c) => recoveryHash(user.id, normalRecovery(c)))), s.now().toISOString());
  } finally {
    s.factorEnrolments.delete(user.id);
  }
  await s.users.deleteSessionsOf(user.id, keepSessionId);
  await recordEvent(s, { kind: "factor_on", userId: user.id, ...req });
  return codes;
}

/** Password and a code, for what takes the factor away or makes new codes. */
async function confirmOwner(s: Services, user: { id: string; username: string }, password: string, code: string, req: RequestInfo): Promise<void> {
  if (!(await s.factors.hasTotp(user.id))) throw new UserError("Kaksivaiheinen kirjautuminen ei ole käytössä.");
  await confirmPassword(s, user, password, req, "kaksivaiheinen kirjautuminen", WRONG_PASSWORD);
  if (!(await takeCode(s, user, code, req))) throw new UserError(WRONG_CODE);
}

export async function removeOwnFactor(s: Services, user: { id: string; username: string }, password: string, code: string, req: RequestInfo): Promise<void> {
  await confirmOwner(s, user, password, code, req);
  await s.factors.removeAll(user.id);
  await recordEvent(s, { kind: "factor_off", userId: user.id, ...req });
}

/** New recovery codes; the ones before are gone. */
export async function remakeRecoveryCodes(s: Services, user: { id: string; username: string }, password: string, code: string, req: RequestInfo): Promise<string[]> {
  await confirmOwner(s, user, password, code, req);
  const codes = newRecoveryCodes();
  await s.factors.replaceRecovery(user.id, await Promise.all(codes.map((c) => recoveryHash(user.id, normalRecovery(c)))), s.now().toISOString());
  await recordEvent(s, { kind: "recovery_codes_made", userId: user.id, ...req });
  return codes;
}

/**
 * Takes another user's factor away (a lost phone) and signs them out everywhere. `by` names who did it, for the event the
 * user is told of: `ylläpitäjä <username>`, or `komentorivi` for the command line (cli.ts, which also removes an admin's).
 */
export async function removeFactorOf(s: Services, targetId: string, by: string, req: RequestInfo = { ip: null, userAgent: null }): Promise<void> {
  await s.factors.removeAll(targetId);
  await s.users.deleteSessionsOf(targetId);
  await recordEvent(s, { kind: "factor_removed_by_admin", userId: targetId, ...req, detail: by, notify: true });
}

/** An admin takes a member's factor away. An admin's own factor is removed by that admin alone, with removeOwnFactor (or by the host's command line). */
export async function removeFactorByAdmin(s: Services, admin: { username: string }, targetId: string, req: RequestInfo): Promise<void> {
  const target = await s.users.get(targetId);
  if (!target) throw new UserError("Käyttäjää ei löydy.");
  if (target.role === "admin") throw new UserError("Ylläpitäjän kaksivaiheisen kirjautumisen voi poistaa vain hän itse.");
  if (!(await s.factors.hasTotp(targetId))) throw new UserError("Jäsenellä ei ole kaksivaiheista kirjautumista.");
  await removeFactorOf(s, targetId, `ylläpitäjä ${admin.username}`, req);
}
