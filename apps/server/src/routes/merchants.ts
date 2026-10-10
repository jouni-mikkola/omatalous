/** Merchants of the signed-in user and the category each one is always put in. Own rows only. */
import { isKnownCategory } from "@banking/core";
import { Hono } from "hono";
import type { AppEnv, Services } from "../services/context.ts";
import { reprocessDetailed } from "../services/enrich.ts";
import { UserError } from "../services/errors.ts";
import { strictObject } from "../services/instance.ts";
import { checkRuleRoom } from "../services/rules.ts";
import { body, queryInt } from "./shared.ts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function merchantName(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 200) throw new UserError("Virheellinen kauppiaan nimi.");
  return value;
}

export function merchantRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.get("/merchants", async (c) => {
    const { q, category, limit } = c.req.query();
    const items = await s.finance(c.get("user").id).merchantSummaries({
      q: q?.slice(0, 100),
      category: category || undefined,
      limit: Math.min(Math.max(queryInt(limit) ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
    });
    return c.json({ items });
  });

  /** Merchants whose spending nothing recognised, for the "Luokittelematta" card. */
  app.get("/merchants/uncategorised", async (c) => c.json({ items: await s.finance(c.get("user").id).uncategorisedMerchants(50) }));

  /** Every row of the merchant, now and later, goes to the category (rows set by hand one by one keep theirs). */
  app.put("/merchants/category", async (c) => {
    const repo = s.finance(c.get("user").id);
    const input = strictObject(await body(c), ["merchant", "category"] as const);
    const merchant = merchantName(input.merchant);
    if (typeof input.category !== "string" || !isKnownCategory(input.category)) throw new UserError("Tuntematon kategoria.");
    if (!(await repo.hasMerchant(merchant))) throw new UserError("Kauppiasta ei löydy.");
    // replacing the merchant's own rule keeps the count; a new one must fit under the cap
    if (!(await repo.hasMerchantRule(merchant))) await checkRuleRoom(repo);
    await repo.setMerchantRule(merchant, input.category);
    return c.json({ changed: (await reprocessDetailed(repo, s.settings)).recategorised });
  });

  /** Back to automatic. The merchant's rule goes and the other rules and the register decide again. */
  app.delete("/merchants/rule", async (c) => {
    const repo = s.finance(c.get("user").id);
    const merchant = merchantName(strictObject(await body(c), ["merchant"] as const).merchant);
    if (!(await repo.deleteMerchantRules(merchant))) return c.json({ changed: 0 });
    return c.json({ changed: (await reprocessDetailed(repo, s.settings)).recategorised });
  });

  return app;
}
