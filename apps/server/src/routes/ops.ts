/** Maintenance requests for the host helper. Admin only (app.ts); see services/ops.ts. */
import { Hono } from "hono";
import type { AppEnv, Services } from "../services/context.ts";
import { cancelOp, opsAudit, opsState, requestOp } from "../services/ops.ts";
import { opsResetRoutes } from "./ops-reset.ts";
import { body, requestInfo } from "./shared.ts";

export function opsRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  // JSON only: a form post (the classic CSRF shape) is refused before anything is read
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && !/^application\/json\b/i.test(c.req.header("content-type") ?? "")) return c.json({ error: "Pyynnön pitää olla JSON." }, 415);
    await next();
  });
  app.route("/", opsResetRoutes(s));

  app.get("/state", async (c) => c.json(await opsState(s, c.get("user").language)));
  app.get("/audit", async (c) => c.json({ events: await opsAudit(s) }));

  app.post("/request", async (c) => c.json({ request: await requestOp(s, c.get("user"), await body(c), requestInfo(c, s)) }));

  app.post("/cancel/:id", async (c) => {
    await cancelOp(s, c.get("user"), c.req.param("id"), requestInfo(c, s));
    return c.json({ ok: true });
  });

  return app;
}
