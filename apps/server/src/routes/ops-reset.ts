/** The reset from the browser, mounted in routes/ops.ts: admin only (app.ts) and JSON only (ops.ts). See services/reset.ts. */
import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { resetData } from "../services/reset.ts";
import { body, requestInfo } from "./shared.ts";

export function opsResetRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.post("/reset", async (c) => {
    const input = strictObject(await body(c), ["password", "confirm"] as const);
    const result = await resetData(s, c.get("user"), input, requestInfo(c, s), c.get("sessionId"));
    // the session went with the rest: the browser drops its cookie and the admin signs in again
    deleteCookie(c, s.config.sessionCookie, { path: "/" });
    return c.json(result);
  });

  return app;
}
