/** Tarkistettavat: the one queue of what the app cannot settle itself. Each item is answered through its own source's route. */
import { Hono } from "hono";
import type { AppEnv, Services } from "../services/context.ts";
import { reviewQueue } from "../services/review.ts";

export function reviewRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  // the signed-in member's own questions: their rows, their marks, the accounts they linked
  app.get("/review", async (c) => c.json(await reviewQueue(s, c.get("user").id)));

  return app;
}
