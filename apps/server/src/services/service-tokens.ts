/**
 * Service tokens: read access for a script or a coding agent without a password and without a session
 * (docs/ADVANCED.md#service-tokens). A token is `omt_` and 32 random bytes in base64url, shown once when it is made; the
 * database keeps its SHA-256. It is sent as `Authorization: Bearer omt_…` and reads as the user it was made for, with a
 * member's rights whatever that user's role, and only through the GET routes READABLE names and those of an extension
 * that says its GETs only read (`tokenReads` in extensions.ts). It is made, listed and removed on the command line
 * (cli-service-token.ts), which needs the host; an admin also lists and removes them in Asetukset. Every token ends: at most MAX_DAYS after it was made.
 */
import type { User } from "../db/rows.ts";
import type { ServiceTokenInfo } from "../db/service-token-repo.ts";
import { EXTENSIONS } from "../extensions.ts";
import { UserError } from "../platform/errors.ts";
import { randomBytes, sha256, toBase64Url } from "../security/encoding.ts";
import type { Services } from "./context.ts";
import { recordEvent } from "./security.ts";

const PREFIX = "omt_";
/** 32 bytes in base64url. */
const TOKEN = /^omt_[A-Za-z0-9_-]{43}$/;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
/** Letters, digits, space, dot, dash and underscore: the name stands in the log and the command line output. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
/** How often a token's last use is written down, with a security event. */
const TOUCH_MS = 60 * 60_000;

/**
 * The routes a token reads, by path. Deny by default: a route added later stays closed to tokens until it is named
 * here. Left out on purpose: sign-in and sessions, the security log and its notices (reading a notice marks it read),
 * the admin and maintenance routes, the bank's callback (a GET that writes), and the exports (a whole copy of the data).
 */
const READABLE: readonly RegExp[] = [
  /^\/api\/auth\/state$/,
  /^\/api\/(meta|foreign-rows|dashboard|ahead|reports|explain|recurring|bill-month|transactions|rules|payer-roles|review|household-members|expected-bills|statements|merchants|merchants\/summary|merchants\/uncategorised|sync\/runs)$/,
  /^\/api\/accounts\/[^/]+\/(sources|use\/suggestion)$/,
  /^\/api\/settlement(\/agreements\/[^/]+)?$/,
  /^\/api\/loans(\/proposals)?$/,
  /^\/api\/optimise(\/evidence)?$/,
  /^\/api\/bank\/logos\/[^/]+$/,
];

/** A path below an extension's prefix: plain segments, none of them a dot segment, no query. */
const EXTENSION_REST = /^(\/[^/?]+)*$/;

/** Whether the path is /api/<id> or below it, for an extension whose GETs all only read. */
function extensionReads(path: string): boolean {
  return EXTENSIONS.some((e) => {
    if (e.tokenReads !== true) return false;
    const prefix = `/api/${e.id}`;
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return false;
    const rest = path.slice(prefix.length);
    return EXTENSION_REST.test(rest) && !rest.split("/").some((seg) => seg === "." || seg === "..");
  });
}

/** Whether a token may make this request: a read of a route READABLE names, or of an extension that says it only reads. */
export function serviceMayRead(method: string, path: string): boolean {
  return (method === "GET" || method === "HEAD") && (READABLE.some((r) => r.test(path)) || extensionReads(path));
}

function parseDays(days: string | undefined): number {
  if (days === undefined) return DEFAULT_DAYS;
  const n = /^\d{1,3}$/.test(days) ? Number(days) : NaN;
  if (!(n >= 1 && n <= MAX_DAYS)) throw new UserError(`Give the days as a whole number from 1 to ${MAX_DAYS}.`);
  return n;
}

/** A new token for `username`. The token is in the answer only: it is stored as its hash and cannot be shown again. */
export async function createServiceToken(
  s: Services,
  input: { username: string; name: string; days?: string },
): Promise<{ id: string; token: string; username: string; expiresAt: string }> {
  const name = input.name.trim();
  if (!NAME.test(name)) throw new UserError("Give the token a name of 1 to 40 letters, digits, spaces, dots, dashes or underscores.");
  const days = parseDays(input.days);
  const user = await s.users.findForLogin(input.username);
  if (!user) throw new UserError(`User ${input.username} not found.`);
  const now = s.now();
  const token = PREFIX + toBase64Url(randomBytes(32));
  const id = toBase64Url(randomBytes(6));
  const expiresAt = new Date(now.getTime() + days * 86_400_000).toISOString();
  await s.serviceTokens.removeExpired(now.toISOString());
  await s.serviceTokens.create({ id, tokenHash: await sha256(token), userId: user.id, name, createdAt: now.toISOString(), expiresAt });
  // the user whose data the token reads is told, also when an admin made it for them
  await recordEvent(s, { kind: "service_token_made", userId: user.id, detail: `${name} (${id}), voimassa ${days} pv`, notify: true });
  return { id, token, username: user.username, expiresAt };
}

export async function listServiceTokens(s: Services): Promise<ServiceTokenInfo[]> {
  await s.serviceTokens.removeExpired(s.now().toISOString());
  return s.serviceTokens.list();
}

/** Removes a token at once; `by` says where (the command line, an admin's name). False when there was none. */
export async function revokeServiceToken(s: Services, id: string, by: string): Promise<boolean> {
  const gone = await s.serviceTokens.remove(id);
  if (!gone) return false;
  await recordEvent(s, { kind: "service_token_removed", userId: gone.userId, detail: `${gone.name} (${gone.id}), ${by}` });
  return true;
}

/**
 * The user a token reads as, with a member's role, or null for a token that is malformed, unknown or ended. The first
 * use in an hour is written down with the address, as a security event of the token's user.
 */
export async function resolveServiceToken(s: Services, token: string, req: { ip: string | null; userAgent: string | null }): Promise<{ user: User; tokenId: string } | null> {
  if (!TOKEN.test(token)) return null;
  const found = await s.serviceTokens.byHash(await sha256(token));
  if (!found) return null;
  const now = s.now();
  if (found.expiresAt <= now.toISOString()) {
    await s.serviceTokens.remove(found.id);
    return null;
  }
  const user = await s.users.get(found.userId);
  if (!user || user.mustChangePassword) return null;
  if (!found.lastUsedAt || now.getTime() - Date.parse(found.lastUsedAt) >= TOUCH_MS) {
    await s.serviceTokens.touch(found.id, now.toISOString(), req.ip);
    await recordEvent(s, { kind: "service_token_used", userId: user.id, ip: req.ip, userAgent: req.userAgent, detail: `${found.name} (${found.id})` });
  }
  return { user: { ...user, role: "member" }, tokenId: found.id };
}
