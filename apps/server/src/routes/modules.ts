/**
 * The Lisäosa card of Asetukset (services/modules.ts, docs/MODULES.md). Admin only. The code goes in and never comes out;
 * every change asks for the admin's password, under the limiter of the other owner routes. A check asks for none and is
 * limited to one every half minute.
 */
import { Hono } from "hono";
import { requireAdmin } from "../auth/middleware.ts";
import { strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { checkModuleNow, moduleView, removeModuleCode, setModuleCode } from "../services/modules.ts";
import { body, requestInfo } from "./shared.ts";

export function moduleRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  app.use("/modules", requireAdmin);
  app.use("/modules/*", requireAdmin);

  app.get("/modules", async (c) => c.json(await moduleView(s)));

  /** No body, no password: a check only fetches a signed release. One every half minute. Answers `{ view, checked }`. */
  app.post("/modules/check", async (c) => c.json(await checkModuleNow(s, c.get("user"))));

  /** `{ code, password }` */
  app.put("/modules/code", async (c) => c.json(await setModuleCode(s, c.get("user"), strictObject(await body(c), ["code", "password"] as const), requestInfo(c, s))));

  /** `{ password }` */
  app.delete("/modules/code", async (c) => c.json(await removeModuleCode(s, c.get("user"), strictObject(await body(c), ["password"] as const), requestInfo(c, s))));

  return app;
}
