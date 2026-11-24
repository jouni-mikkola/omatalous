import { isIP } from "node:net";
import type { Context, MiddlewareHandler, Next } from "hono";
import { codedFor } from "../platform/errors.ts";
import { addressKey } from "../security/rate-limit.ts";
import { recordEvent } from "../services/security.ts";
import type { ServerExtension } from "../extensions.ts";
import { deviceMayReach, deviceTokenOwner, resolveServiceToken, serviceMayRead } from "../services/service-tokens.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { resolveSession } from "./session.ts";

/**
 * Attaches the signed-in user (if any) to the request. Never blocks, except a request that names a bearer token: that
 * one is answered by the token alone (deviceRequest for the prefix of an extension's device tokens, else
 * serviceRequest), and a cookie it also carries is not read.
 */
export function sessionMiddleware(s: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.req.header("authorization");
    if (auth !== undefined && /^bearer\s/i.test(auth)) {
      const token = auth.slice(7).trim();
      const owner = deviceTokenOwner(token);
      return owner ? deviceRequest(c, s, owner, token, next) : serviceRequest(c, s, token, next);
    }
    const session = await resolveSession(c, s);
    if (session) {
      c.set("user", session.user);
      c.set("sessionId", session.sessionId);
    }
    await next();
  };
}

/**
 * A request with a service token (services/service-tokens.ts): 401 for a token that does not open, 403 for anything
 * but a read the token may make, 429 after 20 wrong tokens from one address in 15 minutes (checked before the lookup).
 */
async function serviceRequest(c: Context<AppEnv>, s: Services, token: string, next: Next): Promise<Response | void> {
  const ip = clientIp(c, s);
  const limited = tokenLimited(c, s, ip);
  if (limited) return limited;
  const found = await resolveServiceToken(s, token, { ip, userAgent: c.req.header("user-agent") ?? null });
  if (!found) return tokenRefused(c, s, ip, "auth.token_bad");
  if (!serviceMayRead(c.req.method, c.req.path)) return c.json({ ...codedFor(c, "auth.token_read_only"), code: "forbidden" }, 403);
  c.set("user", found.user);
  c.set("serviceToken", found.tokenId);
  await next();
}

/**
 * A request with an extension's device token (`deviceTokens` in extensions.ts): the same 429 and 401 as a service token,
 * counted by the same limiter, then 403 for any path but the extension's own device routes (deviceMayReach). The user
 * has a member's role, whatever theirs is.
 */
async function deviceRequest(c: Context<AppEnv>, s: Services, e: ServerExtension, token: string, next: Next): Promise<Response | void> {
  const ip = clientIp(c, s);
  const limited = tokenLimited(c, s, ip);
  if (limited) return limited;
  const found = await e.deviceTokens!.resolve(s, token);
  const user = found ? await s.users.get(found.userId) : null;
  if (!user || user.mustChangePassword) return tokenRefused(c, s, ip, "auth.device_token_bad");
  if (!deviceMayReach(e, c.req.path)) return c.json({ ...codedFor(c, "auth.device_token_scope"), code: "forbidden" }, 403);
  c.set("user", { ...user, role: "member" });
  c.set("deviceToken", e.id);
  await next();
}

/** 429 while the address has sent too many wrong tokens (checked before any lookup); null to go on. */
function tokenLimited(c: Context<AppEnv>, s: Services, ip: string): Response | null {
  const wait = s.serviceTokenLimiter.check(addressKey(ip), s.now().getTime());
  return wait > 0 ? c.json({ ...codedFor(c, "auth.token_too_many"), code: "rate_limited" }, 429, { "Retry-After": String(Math.max(1, Math.ceil(wait))) }) : null;
}

/** 401 for a token that does not open, counted toward the limit; the security log hears once when the limit is reached. */
async function tokenRefused(c: Context<AppEnv>, s: Services, ip: string, message: "auth.token_bad" | "auth.device_token_bad"): Promise<Response> {
  const key = addressKey(ip);
  const now = s.now().getTime();
  if (s.serviceTokenLimiter.consume(key, now).wait === 0 && s.serviceTokenLimiter.check(key, now) > 0) {
    await recordEvent(s, { kind: "service_token_refused", ip, userAgent: c.req.header("user-agent") ?? null, detail: "liian monta väärää palvelutunnusta" });
  }
  return c.json({ ...codedFor(c, message), code: "unauthenticated" }, 401);
}

/** 401 without a session; 403 until a temporary password has been changed. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ ...codedFor(c, "auth.login_required"), code: "unauthenticated" }, 401);
  if (user.mustChangePassword) return c.json({ ...codedFor(c, "auth.change_password_first"), code: "password_change_required" }, 403);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user")?.role !== "admin") return c.json({ ...codedFor(c, "app.admin_only"), code: "forbidden" }, 403);
  await next();
};

/**
 * CSRF protection for state-changing API calls. Browsers only add a custom
 * header to same-origin requests (or after a CORS preflight we never allow),
 * so requiring it blocks forged cross-site POSTs. The Origin check is a
 * second line of defence: it must be the configured address or the host the
 * request was sent to (behind a TLS proxy the scheme differs, so the host
 * is compared).
 */
export function csrfGuard(s: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
    if (c.req.header("x-requested-with") !== "fetch") return c.json({ ...codedFor(c, "app.bad_request"), code: "csrf" }, 403);
    const origin = c.req.header("origin");
    // a device token reads no cookie, so a forged request has nothing of the browser's to borrow; its Origin is the device's
    if (origin && c.get("deviceToken") === undefined && !originAllowed(origin, c.req.url, c.req.header("host"), s.instance.current.appBaseUrl, s.config.defaults.appBaseUrl)) {
      return c.json({ ...codedFor(c, "app.bad_request"), code: "csrf" }, 403);
    }
    await next();
  };
}

function originAllowed(origin: string, requestUrl: string, hostHeader: string | undefined, ...configured: string[]): boolean {
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (configured.some((base) => base === o.origin)) return true;
  const host = hostHeader ?? new URL(requestUrl).host;
  return (o.protocol === "https:" || o.protocol === "http:") && o.host === host;
}

/** The IPv4 or IPv6 address in a header value, without a port or brackets; undefined for anything else. */
function addressOf(raw: string | undefined): string | undefined {
  let v = raw?.trim();
  if (!v || v.length > 60) return undefined;
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(v);
  if (bracketed) v = bracketed[1];
  else {
    const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(v);
    if (withPort) v = withPort[1];
  }
  return v && isIP(v) !== 0 ? v : undefined;
}

/**
 * Client address, as security events record it. The limiters count it by
 * addressKey (security/rate-limit.ts), an IPv6 client by its /64. Proxy
 * headers count only with TRUST_PROXY, and then only the parts the proxy
 * itself wrote: a CF-Connecting-IP header, else the last X-Forwarded-For
 * entry (Caddy appends the address it saw; earlier entries come from the
 * client). Caddy drops a CF-Connecting-IP from the client (deploy/Caddyfile).
 */
export function clientIp(c: Context, s: Services): string {
  if (s.config.trustProxy) {
    const cf = addressOf(c.req.header("cf-connecting-ip"));
    if (cf) return cf;
    const forwarded = addressOf(c.req.header("x-forwarded-for")?.split(",").pop());
    if (forwarded) return forwarded;
  }
  // @hono/node-server passes the Node request as c.env.incoming
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "local";
}
