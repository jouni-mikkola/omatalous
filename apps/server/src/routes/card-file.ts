/**
 * Rows of a card statement file, read in the browser (ADR 0025). Own cards only; the body is rows, never the file.
 */
import { Hono } from "hono";
import type { AppEnv, Services } from "../services/context.ts";
import { parseCardFile, saveCardFile } from "../services/card-file.ts";
import { body } from "./shared.ts";

export function cardFileRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  app.post("/card-file", async (c) => c.json(await saveCardFile(s, c.get("user").id, parseCardFile(await body(c)))));
  return app;
}
