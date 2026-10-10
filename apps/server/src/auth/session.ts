/**
 * Cookie sessions. The browser gets a random 256-bit token; the database
 * stores only its SHA-256, so a leaked database cannot be used to log in.
 * Sessions slide: each use (at most hourly) extends them by SESSION_DAYS.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { User } from "../db/rows.ts";
import { randomBytes, sha256, toBase64Url } from "../security/encoding.ts";
import type { Services } from "../services/context.ts";

/** Cookie of versions before per-instance names; read once, never deleted (an older instance on this host may still use it). */
const LEGACY_COOKIE = "talous_session";
const TOUCH_INTERVAL_MS = 60 * 60_000;

/**
 * Secure cookies need HTTPS; plain-http LAN use (http://192.168.x.x) must
 * still work. Behind a TLS proxy that sets no headers, the
 * request is https when it was sent to the configured https address.
 */
export function isHttps(c: Context, s: Services): boolean {
  if (s.config.trustProxy && c.req.header("x-forwarded-proto") === "https") return true;
  const url = new URL(c.req.url);
  if (url.protocol === "https:") return true;
  const base = new URL(s.instance.current.appBaseUrl);
  return base.protocol === "https:" && (c.req.header("host") ?? url.host) === base.host;
}

export async function startSession(c: Context, s: Services, userId: string): Promise<void> {
  const token = toBase64Url(randomBytes(32));
  const expires = new Date(s.now().getTime() + s.config.sessionDays * 86_400_000);
  await s.users.createSession(await sha256(token), userId, expires.toISOString(), c.req.header("user-agent") ?? null);
  setSessionCookie(c, s, token);
}

function setSessionCookie(c: Context, s: Services, token: string): void {
  setCookie(c, s.config.sessionCookie, token, {
    httpOnly: true,
    sameSite: "Lax", // sent on the bank's redirect back (top-level GET), not on cross-site POSTs
    secure: isHttps(c, s),
    path: "/",
    maxAge: s.config.sessionDays * 86_400,
  });
}

export async function resolveSession(c: Context, s: Services): Promise<{ user: User; sessionId: string } | null> {
  const current = getCookie(c, s.config.sessionCookie);
  const token = current ?? getCookie(c, LEGACY_COOKIE);
  if (!token || token.length > 100) return null;
  const sessionId = await sha256(token);
  const session = await s.users.getSession(sessionId);
  const now = s.now();
  if (!session) return null;
  if (session.expiresAt < now.toISOString()) {
    await s.users.deleteSession(sessionId);
    return null;
  }
  const user = await s.users.get(session.userId);
  if (!user) return null;
  if (now.getTime() - Date.parse(session.lastSeenAt) > TOUCH_INTERVAL_MS) {
    await s.users.touchSession(sessionId, new Date(now.getTime() + s.config.sessionDays * 86_400_000).toISOString());
  }
  if (current === undefined) setSessionCookie(c, s, token); // legacy cookie: move the session to the new name
  return { user, sessionId };
}

export async function endSession(c: Context, s: Services, sessionId: string): Promise<void> {
  await s.users.deleteSession(sessionId);
  deleteCookie(c, s.config.sessionCookie, { path: "/" });
}
