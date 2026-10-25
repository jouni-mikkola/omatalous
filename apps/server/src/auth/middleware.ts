import type { FeatureId } from "@banking/core";
import { type Context, Hono, type MiddlewareHandler, type Next } from "hono";
import { addressKey } from "../security/rate-limit.ts";
import { recordEvent } from "../services/security.ts";
import { resolveServiceToken, serviceMayRead } from "../services/service-tokens.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { resolveSession } from "./session.ts";
import type { ExtensionFlags } from "../extensions.ts";

/**
 * Attaches the signed-in user (if any) to the request. Never blocks, except a request that names a service token: that
 * one is answered by the token alone (serviceRequest), and a cookie it also carries is not read.
 */
export function sessionMiddleware(s: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.req.header("authorization");
    if (auth !== undefined && /^bearer\s/i.test(auth)) return serviceRequest(c, s, auth.slice(7).trim(), next);
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
  const key = addressKey(ip);
  const now = s.now().getTime();
  if (s.serviceTokenLimiter.check(key, now) > 0) return c.json({ error: "Liian monta yritystä. Yritä myöhemmin uudelleen.", code: "rate_limited" }, 429);
  const found = await resolveServiceToken(s, token, { ip, userAgent: c.req.header("user-agent") ?? null });
  if (!found) {
    if (s.serviceTokenLimiter.consume(key, now).wait === 0 && s.serviceTokenLimiter.check(key, now) > 0) {
      await recordEvent(s, { kind: "service_token_refused", ip, userAgent: c.req.header("user-agent") ?? null, detail: "liian monta väärää palvelutunnusta" });
    }
    return c.json({ error: "Palvelutunnus ei kelpaa.", code: "unauthenticated" }, 401);
  }
  if (!serviceMayRead(c.req.method, c.req.path)) return c.json({ error: "Palvelutunnuksella voi vain lukea.", code: "forbidden" }, 403);
  c.set("user", found.user);
  c.set("serviceToken", found.tokenId);
  await next();
}

/** 401 without a session; 403 until a temporary password has been changed. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Kirjaudu sisään.", code: "unauthenticated" }, 401);
  if (user.mustChangePassword) return c.json({ error: "Vaihda väliaikainen salasana ensin.", code: "password_change_required" }, 403);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user")?.role !== "admin") return c.json({ error: "Vain ylläpitäjälle.", code: "forbidden" }, 403);
  await next();
};

/** 404 while the module's feature flag is off, with the words of an unknown path so its existence is not shown. */
function requireFeature(s: Services, id: FeatureId | keyof ExtensionFlags): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!s.instance.enabled(id)) return c.json({ error: "Ei löydy." }, 404);
    await next();
  };
}

/**
 * A module's routes behind its feature flag, to mount at the module's own prefix. In Hono a handler registered before
 * `use()` runs without that middleware, so the guard is the first thing of a sub-app the routes join afterwards.
 */
export function gated(s: Services, id: FeatureId | keyof ExtensionFlags, routes: Hono<AppEnv>): Hono<AppEnv> {
  return new Hono<AppEnv>().use("*", requireFeature(s, id)).route("/", routes);
}

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
    if (c.req.header("x-requested-with") !== "fetch") return c.json({ error: "Virheellinen pyyntö. Lataa sivu uudelleen.", code: "csrf" }, 403);
    const origin = c.req.header("origin");
    if (origin && !originAllowed(origin, c.req.url, c.req.header("host"), s.instance.current.appBaseUrl, s.config.defaults.appBaseUrl)) {
      return c.json({ error: "Virheellinen pyyntö. Lataa sivu uudelleen.", code: "csrf" }, 403);
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

/**
 * Client address, as security events record it. The limiters count it by
 * addressKey (security/rate-limit.ts), an IPv6 client by its /64. Proxy
 * headers count only with TRUST_PROXY, and then only the parts the proxy
 * itself wrote: Cloudflare's CF-Connecting-IP, else the last X-Forwarded-For
 * entry (Caddy and cloudflared append the address they saw; earlier entries
 * come from the client).
 */
export function clientIp(c: Context, s: Services): string {
  if (s.config.trustProxy) {
    const cf = c.req.header("cf-connecting-ip")?.trim();
    if (cf) return cf;
    const forwarded = c.req.header("x-forwarded-for")?.split(",").pop()?.trim();
    if (forwarded) return forwarded;
  }
  // @hono/node-server passes the Node request as c.env.incoming
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "local";
}
