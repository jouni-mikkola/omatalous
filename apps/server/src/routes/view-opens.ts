/** The views the signed-in member opened. A write of the member's own rows; no data version is bumped. */
import { Hono } from "hono";
import type { AppEnv, Services } from "../services/context.ts";
import { recordViewOpens } from "../services/view-opens.ts";
import { strictObject } from "../platform/validate.ts";
import { body } from "./shared.ts";

export function viewOpensRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.post("/views/open", async (c) => {
    await recordViewOpens(s, c.get("user").id, strictObject(await body(c), ["views"] as const));
    return c.json({ ok: true });
  });

  return app;
}
