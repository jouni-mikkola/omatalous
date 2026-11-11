/**
 * The numbers Tarkistettavat asks for, mounted at their own prefix. The route parses the request and calls
 * services/optimise.ts, which owns the writes.
 */
import { Hono } from "hono";
import { strictObject } from "../platform/validate.ts";
import { parseScope } from "../services/analysis.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { deleteInput, setInput } from "../services/optimise.ts";
import { body } from "./shared.ts";

export function optimiseRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.put("/inputs/:key", async (c) => {
    const { value } = strictObject(await body(c), ["value"] as const);
    return c.json(await setInput(s, c.get("user").id, parseScope(c.req.query("scope")), c.req.param("key"), value, c.get("user").language));
  });

  app.delete("/inputs/:key", async (c) => c.json(await deleteInput(s, c.get("user").id, c.req.param("key"))));

  return app;
}
