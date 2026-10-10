import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, Services } from "../services/context.ts";
import { resolveSession } from "./session.ts";

/** Attaches the signed-in user (if any) to the request. Never blocks. */
export function sessionMiddleware(s: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await resolveSession(c, s);
    if (session) {
      c.set("user", session.user);
      c.set("sessionId", session.sessionId);
    }
    await next();
  };
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
 * Client address for rate limiting. Proxy headers count only with
 * TRUST_PROXY, and then only the parts the proxy itself wrote: Cloudflare's
 * CF-Connecting-IP, else the last X-Forwarded-For entry (Caddy and
 * cloudflared append the address they saw; earlier entries come from the client).
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
