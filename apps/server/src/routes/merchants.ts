/** Merchants of the signed-in user and the category each one is always put in. Own rows only. */
import { isKnownCategory } from "@banking/core";
import { Hono } from "hono";
import type { AppEnv, Services } from "../services/context.ts";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import { clearMerchantRule, setMerchantCategory } from "../services/rules.ts";
import { parseScope, sharedInView } from "../services/analysis.ts";
import { body, queryInt } from "./shared.ts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function parseMerchantName(value: unknown): string {
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

  /**
   * The summary above Tapahtumat when it is filtered to one merchant: the whole history, not the filtered period.
   * The name only ever binds as a parameter. A recurring payment adds its cadence and next expected date.
   */
  app.get("/merchants/summary", async (c) => {
    const user = c.get("user");
    const merchant = parseMerchantName(c.req.query("merchant"));
    const scope = parseScope(c.req.query("scope"));
    const shared = scope === "household" ? (await sharedInView(s, user.id)).map((a) => a.id) : undefined;
    const history = await s.finance(user.id).merchantHistory(merchant, shared);
    if (!history) return c.json({ summary: null });
    // the analysis is cached per user and data version; only a recurring series needs it
    const { ctx } = await s.analysis.get(s, user.id, scope);
    const series = ctx.recurring.filter((r) => r.merchant === merchant).sort((a, b) => Number(b.active) - Number(a.active) || (a.lastDate < b.lastDate ? 1 : -1))[0];
    return c.json({
      summary: {
        merchant,
        ...history,
        recurring: series?.cadence ? { cadence: series.cadence, active: series.active, nextDate: series.active ? series.nextDate : null, typicalAmountCents: series.typicalAmountCents } : null,
      },
    });
  });

  /** Merchants whose spending nothing recognised, for the "Luokittelematta" card. */
  app.get("/merchants/uncategorised", async (c) => c.json({ items: await s.finance(c.get("user").id).uncategorisedMerchants(50) }));

  /** Every row of the merchant, now and later, goes to the category (rows set by hand one by one keep theirs). */
  app.put("/merchants/category", async (c) => {
    const input = strictObject(await body(c), ["merchant", "category"] as const);
    const merchant = parseMerchantName(input.merchant);
    if (typeof input.category !== "string" || !isKnownCategory(input.category)) throw new UserError("Tuntematon kategoria.");
    return c.json({ changed: await setMerchantCategory(s, c.get("user").id, merchant, input.category) });
  });

  /** Back to automatic. The merchant's rule goes and the other rules and the register decide again. */
  app.delete("/merchants/rule", async (c) => {
    const merchant = parseMerchantName(strictObject(await body(c), ["merchant"] as const).merchant);
    return c.json({ changed: await clearMerchantRule(s, c.get("user").id, merchant) });
  });

  return app;
}
