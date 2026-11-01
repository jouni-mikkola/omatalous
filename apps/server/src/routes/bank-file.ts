/**
 * Rows of a bank's CSV export, read in the browser (ADR 0025). Accounts made here only; the body is rows, never the file.
 */
import { Hono } from "hono";
import type { AppEnv, Services } from "../services/context.ts";
import { parseCardFile, saveBankFile } from "../services/card-file.ts";
import { body } from "./shared.ts";

export function bankFileRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  app.post("/bank-file", async (c) => c.json(await saveBankFile(s, c.get("user").id, parseCardFile(await body(c)))));
  return app;
}
