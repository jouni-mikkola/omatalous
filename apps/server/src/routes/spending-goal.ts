/** The monthly spending goal of the signed-in user. Own row only; the dashboard carries it back (`DashboardData.goal`). */
import { Hono } from "hono";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { body } from "./shared.ts";

/** A euro: a goal of cents is a slip of the decimal point. */
const MIN_CENTS = 100;
/** A million euros a month: a typo stays visible, and core's sums stay exact. */
const MAX_CENTS = 100_000_000;

/** The goal in whole cents, or a UserError with a message safe to show. */
function parseGoal(raw: unknown): number {
  const cents = strictObject(raw, ["monthlyCents"] as const).monthlyCents;
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents < MIN_CENTS || cents > MAX_CENTS) {
    throw new UserError("Tavoitteen pitää olla vähintään 1 € ja enintään 1 000 000 € kuussa.");
  }
  return cents;
}

export function spendingGoalRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.put("/spending-goal", async (c) => {
    const monthlyCents = parseGoal(await body(c));
    // read per request like the other inputs: nothing is cached and no data version moves
    await s.finance(c.get("user").id).setSpendingGoal(monthlyCents, s.now().toISOString());
    return c.json({ monthlyCents });
  });

  // removing a goal that is not there is the same as removing one that is
  app.delete("/spending-goal", async (c) => {
    await s.finance(c.get("user").id).clearSpendingGoal();
    return c.json({ ok: true });
  });

  return app;
}
