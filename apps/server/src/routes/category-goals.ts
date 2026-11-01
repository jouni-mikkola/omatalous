/** The monthly spending goal per category of the signed-in user. Own rows only; the reports and the dashboard carry them back. */
import { isGoalCategory, MAX_CATEGORY_GOAL_CENTS, MIN_CATEGORY_GOAL_CENTS } from "@banking/core";
import { Hono } from "hono";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { body } from "./shared.ts";

/** A category the goals cover, or a UserError with a message safe to show. */
function parseCategory(raw: unknown): string {
  if (typeof raw !== "string" || !isGoalCategory(raw)) throw new UserError("Aseta tavoite vain ruoalle, ravintoloille ja liikenteelle.");
  return raw;
}

function parseGoal(raw: unknown): { category: string; monthlyCents: number } {
  const o = strictObject(raw, ["category", "monthlyCents"] as const);
  const category = parseCategory(o.category);
  const cents = o.monthlyCents;
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents < MIN_CATEGORY_GOAL_CENTS || cents > MAX_CATEGORY_GOAL_CENTS) {
    throw new UserError("Tavoitteen pitää olla vähintään 1 € ja enintään 1 000 000 € kuussa.");
  }
  return { category, monthlyCents: cents };
}

export function categoryGoalRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.put("/category-goals", async (c) => {
    const goal = parseGoal(await body(c));
    // read per request like the other inputs: nothing is cached and no data version moves
    await s.finance(c.get("user").id).setCategoryGoal(goal.category, goal.monthlyCents, s.now().toISOString());
    return c.json(goal);
  });

  // removing a goal that is not there is the same as removing one that is
  app.delete("/category-goals", async (c) => {
    const { category } = strictObject(await body(c), ["category"] as const);
    await s.finance(c.get("user").id).clearCategoryGoal(parseCategory(category));
    return c.json({ ok: true });
  });

  return app;
}
