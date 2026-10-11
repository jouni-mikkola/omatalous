/**
 * HTTP application: middleware stack and route modules. entry/node.ts
 * serves it with the static web UI and runs the hourly scheduler.
 *
 * In order: security headers, no-store, body limit, instance settings,
 * session, CSRF guard, public routes (health, auth, bank callback), login
 * required, admin routes, user routes.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { csrfGuard, requireAdmin, requireUser, sessionMiddleware } from "./auth/middleware.ts";
import { adminRoutes } from "./routes/admin.ts";
import { authRoutes } from "./routes/auth.ts";
import { bankCallbackRoute, bankRoutes } from "./routes/bank.ts";
import { CSV_BODY_MAX, dataRoutes } from "./routes/data.ts";
import { expectedBillRoutes } from "./routes/expected-bills.ts";
import { financeRoutes } from "./routes/finance.ts";
import { marksRoutes } from "./routes/marks.ts";
import { securityRoutes } from "./routes/security.ts";
import { opsRoutes } from "./routes/ops.ts";
import { merchantRoutes } from "./routes/merchants.ts";
import { userRoutes } from "./routes/users.ts";
import { HttpUserError, TooManyAttempts, UpstreamError, UserError } from "./platform/errors.ts";
import { type AppDeps, type AppEnv, createServices, type Services } from "./services/context.ts";
import { checkHealth } from "./services/health.ts";

export type { AppDeps } from "./services/context.ts";

export function createApp(deps: AppDeps): Hono<AppEnv> & { services: Services } {
  const s = createServices(deps);
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof TooManyAttempts) return c.json({ error: err.message }, 429, { "Retry-After": String(err.retryAfter) });
    if (err instanceof HttpUserError) return c.json({ error: err.message }, err.status);
    if (err instanceof UserError) return c.json({ error: err.message }, 400);
    if (err instanceof UpstreamError) {
      console.error(err.message);
      return c.json({ error: err.userMessage }, 502);
    }
    console.error(err);
    return c.json({ error: "Jokin meni vikaan. Yritä uudelleen." }, 500);
  });

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
      },
      referrerPolicy: "no-referrer",
      strictTransportSecurity: "max-age=31536000",
    }),
  );
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.use("/api/*", (c, next) => {
    // a bank export is a few hundred KB; everything else is small JSON
    const max = c.req.path === "/api/import/csv" ? CSV_BODY_MAX : 256 * 1024;
    return bodyLimit({ maxSize: max, onError: (c2) => c2.json({ error: "Pyyntö on liian suuri." }, 413) })(c, next);
  });
  app.use("/api/*", async (_c, next) => {
    // address, time zone etc. set in the browser (read once, then kept in memory; saving updates it)
    await s.instance.load();
    await next();
  });
  app.use("/api/*", sessionMiddleware(s)); // static files need no session lookup
  app.use("/api/*", csrfGuard(s));

  // public
  app.get("/api/health", async (c) => {
    const health = await checkHealth(s);
    return c.json(health, health.ok ? 200 : 503);
  });
  app.route("/api/auth", authRoutes(s));
  app.route("/api", bankCallbackRoute(s));

  // everything below needs a signed-in user
  app.use("/api/*", requireUser);
  app.use("/api/users", requireAdmin);
  app.use("/api/users/*", requireAdmin);
  app.use("/api/admin/*", requireAdmin);
  app.use("/api/ops", requireAdmin);
  app.use("/api/ops/*", requireAdmin);
  app.route("/api/users", userRoutes(s));
  app.route("/api/security", securityRoutes(s));
  app.route("/api/admin", adminRoutes(s));
  app.route("/api/ops", opsRoutes(s));
  app.route("/api", financeRoutes(s));
  app.route("/api", marksRoutes(s));
  app.route("/api", expectedBillRoutes(s));
  app.route("/api", merchantRoutes(s));
  app.route("/api", bankRoutes(s));
  app.route("/api", dataRoutes(s));
  app.all("/api/*", (c) => c.json({ error: "Ei löydy." }, 404));

  return Object.assign(app, { services: s });
}
