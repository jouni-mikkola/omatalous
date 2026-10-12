/**
 * Merchants of the signed-in user and the category each one is always put in. The list and the unrecognised spending
 * read the rows the user can categorise, their own. `scope` picks how they count, as on every page: the own view has
 * a joint account at the user's part and nothing of an account somebody else uses alone, the household view has every
 * row whole.
 */
import { isKnownCategory, merchantBasis, merchantMonthly } from "@banking/core";
import { Hono } from "hono";
import type { AppEnv, Services } from "../services/context.ts";
import { UserError } from "../platform/errors.ts";
import { parseIsoDate, strictObject } from "../platform/validate.ts";
import { clearMerchantRule, setMerchantCategory } from "../services/rules.ts";
import { parseScope, rowsInView } from "../services/analysis.ts";
import { body, queryInt } from "./shared.ts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function parseMerchantName(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 200) throw new UserError("Virheellinen kauppiaan nimi.");
  return value;
}

export function merchantRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  /**
   * The merchants of Tapahtumat > Kauppiaat. `from` and `to` narrow the rows the figures add up, `habit=1` keeps the
   * merchants the recurring detection calls everyday purchases (Arkiostot), and `months` is the complete months that
   * `monthlyCents` (Kuussa) of a merchant without an active series divides by.
   */
  app.get("/merchants", async (c) => {
    const user = c.get("user");
    const { q, category, limit, from, to, habit } = c.req.query();
    if (habit && habit !== "1") throw new UserError("Virheellinen rajaus.");
    const scope = parseScope(c.req.query("scope"));
    // the set and the series figures are the detection's, not a second definition: the analysis is cached per user and data version
    const [{ ctx }, { own }] = await Promise.all([s.analysis.get(s, user.id, scope), rowsInView(s, user.id, scope)]);
    const only = habit ? new Set(ctx.recurring.filter((r) => r.kind === "habit" && r.active).map((r) => r.merchant)) : undefined;
    return c.json(
      await s.finance(user.id).merchantSummaries({
        q: q?.slice(0, 100),
        category: category || undefined,
        from: from ? parseIsoDate(from, "Virheellinen aikaväli.") : undefined,
        to: to ? parseIsoDate(to, "Virheellinen aikaväli.") : undefined,
        only,
        limit: Math.min(Math.max(queryInt(limit) ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
        basis: merchantBasis(ctx),
        own,
      }),
    );
  });

  /**
   * The summary above Tapahtumat when it is filtered to one merchant: the whole history, not the filtered period.
   * The name only ever binds as a parameter. A recurring payment adds its cadence and next expected date, and the
   * figure per month is the one Kauppiaat shows (`merchantMonthly`).
   */
  app.get("/merchants/summary", async (c) => {
    const user = c.get("user");
    const merchant = parseMerchantName(c.req.query("merchant"));
    const scope = parseScope(c.req.query("scope"));
    // the same rows as the transaction list of the view, and sums of parts as above it
    const { shared, own } = await rowsInView(s, user.id, scope);
    const history = await s.finance(user.id).merchantHistory(merchant, shared.map((a) => a.id), own);
    if (!history) return c.json({ summary: null });
    // the analysis is cached per user and data version: the series and the complete months come from it
    const { ctx } = await s.analysis.get(s, user.id, scope);
    const series = ctx.recurring.filter((r) => r.merchant === merchant).sort((a, b) => Number(b.active) - Number(a.active) || (a.lastDate < b.lastDate ? 1 : -1))[0];
    const basis = merchantBasis(ctx);
    const { outByMonth, ...totals } = history;
    const outInMonths = basis.months.reduce((n, m) => n + (outByMonth[m] ?? 0), 0);
    return c.json({
      summary: {
        merchant,
        ...totals,
        monthly: merchantMonthly(basis, merchant, outInMonths),
        recurring: series?.cadence ? { cadence: series.cadence, active: series.active, nextDate: series.active ? series.nextDate : null, typicalAmountCents: series.typicalAmountCents } : null,
      },
    });
  });

  /** The 50 biggest merchants whose spending nothing recognised, with the count and sum of all, for the "Luokittelematta" card. */
  app.get("/merchants/uncategorised", async (c) => {
    const userId = c.get("user").id;
    return c.json(await s.finance(userId).uncategorisedMerchants(50, (await rowsInView(s, userId, parseScope(c.req.query("scope")))).own));
  });

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
