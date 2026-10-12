/**
 * GET /api/bank/logos/:id: the logo of a bank on the household's list, for a signed-in user. The server fetches the
 * picture from Enable Banking (connectors/enable-banking/logos.ts) and serves it from the app's own address, so the
 * browser never calls a third party.
 *
 * The id picks a bank of the server's registry. The address comes from the bank list the server already holds, never
 * from the request. An id outside the registry, a bank that is not on the list and a bank without a logo all get the
 * same 404, and none of them makes an outbound call.
 */
import { Hono, type MiddlewareHandler } from "hono";
import { knownBankList } from "../connectors/enable-banking/app-setup.ts";
import { bankById, findAspsp } from "../connectors/enable-banking/banks.ts";
import { logoFor } from "../connectors/enable-banking/logos.ts";
import { NotFound } from "../platform/errors.ts";
import type { AppEnv, Services } from "../services/context.ts";

export const BANK_LOGO_PATH = "/api/bank/logos";

/**
 * The picture is somebody else's file. Opened on its own it may load nothing and run nothing: `sandbox` gives it an
 * origin of its own, so an SVG with a script in it cannot reach the app. The inline style is what an SVG draws with.
 * No page may frame it either: `default-src` does not cover that, so the policy names it.
 */
const LOGO_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox";
/** The browser keeps the picture for a day, for this user only. */
const LOGO_CACHE = "private, max-age=86400";

/** The requests that were answered with a picture. */
const served = new WeakSet<Request>();

/**
 * Puts a served picture's own headers on it. app.ts registers this before every other middleware, so it is the last
 * to touch the answer: the app's Content-Security-Policy and `Cache-Control: no-store` are for its pages and its JSON,
 * and both are set on the way out. Every other answer (401, 404) keeps the app's headers.
 */
export const bankLogoHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (!served.has(c.req.raw)) return;
  c.header("Content-Security-Policy", LOGO_CSP);
  c.header("Cache-Control", LOGO_CACHE);
  c.header("X-Content-Type-Options", "nosniff");
};

export function bankLogoRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  app.get("/:id", async (c) => {
    const bank = bankById(c.req.param("id"));
    const list = bank ? await knownBankList(s) : null;
    const entry = bank && list ? findAspsp(bank, list) : undefined;
    const logo = bank && list && entry ? await logoFor(s, list, bank, entry.logo) : null;
    if (!logo) throw new NotFound("Logoa ei löydy.");
    served.add(c.req.raw);
    return c.body(logo.bytes, 200, { "Content-Type": logo.type });
  });
  return app;
}
