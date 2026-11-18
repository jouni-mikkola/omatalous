/**
 * The merchant pages add money up in SQL (`merchantSummaries`, `merchantHistory`, `uncategorisedMerchants`), a third way
 * beside the core flows of the dashboard and the strip of the transaction list. Each check here sets one of those sums
 * against the flows of the same rows, in the own view and the household view, on a household with a refund, a card
 * statement, a loan account, money moved to savings and a joint account that is cut into parts.
 */
import { type AnalysisContext, totalsOf } from "@banking/core";
import { beforeAll, describe, expect, it } from "vitest";
import { type Client } from "./helpers.ts";
import { AUGUST, BOTH_MONTHS, loadSumsHousehold, SEPTEMBER, type SumsHousehold } from "./sums-household.ts";

type Scope = "own" | "household";
const SCOPES: readonly Scope[] = ["own", "household"];
const RANGES = [BOTH_MONTHS, AUGUST, SEPTEMBER] as const;

interface MerchantItem { merchant: string; category: string; count: number; totalCents: number; inCents: number }

let home: SumsHousehold;
beforeAll(async () => {
  home = await loadSumsHousehold();
}, 30_000);

const get = async (c: Client, path: string) => (await c.call("GET", path)).body;
const query = (range: { from: string; to: string }, scope: Scope) => `from=${range.from}&to=${range.to}&scope=${scope}`;
const contextOf = async (c: Client & { id: string }, scope: Scope): Promise<AnalysisContext> => (await home.s.analysis.get(home.s, c.id, scope)).ctx;
const merchantOf = (ctx: AnalysisContext, counterparty: string): string => {
  const row = ctx.txs.find((t) => t.counterparty === counterparty);
  if (!row) throw new Error(`no row of ${counterparty}`);
  return row.merchant;
};
const isCardBill = (t: { category: string; amountCents: number }) => t.category === "card_bill" && t.amountCents < 0;

/** What the flows of a merchant's rows in a range spend and save less what they earn, net of what came back: the figure the SQL sums claim to be. */
function flowsNet(ctx: AnalysisContext, merchant: string, range: { from: string; to: string }): { net: number; rows: number } {
  const rows = ctx.txs.filter((t) => t.merchant === merchant && !t.isTransfer && !isCardBill(t) && t.bookingDate >= range.from && t.bookingDate <= range.to);
  const totals = totalsOf(rows.map((t) => t.flows));
  return { net: totals.expenseCents + totals.savedCents - totals.incomeCents, rows: rows.length };
}

describe("the merchant list sums what the flows of the same rows sum", () => {
  it.each(SCOPES)("money out less money in of each merchant is its spending and saving in the flows (%s view)", async (scope) => {
    const ctx = await contextOf(home.aino, scope);
    const mismatches: string[] = [];
    for (const range of RANGES) {
      const { items } = await get(home.aino, `/api/merchants?limit=1000&${query(range, scope)}`);
      expect(items.length).toBeGreaterThan(5);
      for (const m of items as MerchantItem[]) {
        const core = flowsNet(ctx, m.merchant, range);
        if (m.count !== core.rows) mismatches.push(`${range.from} ${m.merchant}: count ${m.count}, rows ${core.rows}`);
        if (m.totalCents - m.inCents !== core.net) mismatches.push(`${range.from} ${m.merchant}: list ${m.totalCents} - ${m.inCents}, flows ${core.net}`);
      }
    }
    expect(mismatches.join("\n")).toBe("");
  });

  it.each(SCOPES)("the merchants of a month add up to the dashboard's spending and saving less its income (%s view)", async (scope) => {
    const ctx = await contextOf(home.aino, scope);
    const mismatches: string[] = [];
    for (const range of [AUGUST, SEPTEMBER]) {
      const { items } = await get(home.aino, `/api/merchants?limit=1000&${query(range, scope)}`);
      const listed = (items as MerchantItem[]).reduce((n, m) => n + m.totalCents - m.inCents, 0);
      const { totals } = await get(home.aino, `/api/dashboard?${query(range, scope)}`);
      const wanted = totals.expenseCents + totals.savedCents - totals.incomeCents;
      if (listed !== wanted) {
        const lines = (items as MerchantItem[]).map((m) => `${m.merchant} ${m.totalCents - m.inCents} (flows ${flowsNet(ctx, m.merchant, range).net})`);
        mismatches.push(`${range.from} ${scope}: merchants ${listed}, dashboard ${wanted}; ${lines.join(", ")}`);
      }
    }
    expect(mismatches.join("\n")).toBe("");
  });

  it("a refund lowers what the merchant was paid in both views, and the joint account counts at its half in the own view only", async () => {
    const own = await contextOf(home.aino, "own");
    const shop = merchantOf(own, "YHTEINEN KAUPPA");
    const sport = merchantOf(own, "URHEILUKAUPPA ESIMERKKI OY");
    const figure = async (scope: Scope, merchant: string) => ((await get(home.aino, `/api/merchants?limit=1000&q=${encodeURIComponent(merchant)}&${query(BOTH_MONTHS, scope)}`)).items as MerchantItem[]).find((m) => m.merchant === merchant)!;
    // the shop's rows: 84.37 + 60 + 0.01 out and 15.99 back, the refund in the month after the purchase
    expect((await figure("household", shop)).totalCents - (await figure("household", shop)).inCents).toBe(8437 + 6000 + 1 - 1599);
    expect((await figure("own", shop)).totalCents).toBeLessThan((await figure("household", shop)).totalCents);
    // the sports shop paid 80 and gave 80 back
    const sports = await figure("household", sport);
    expect([sports.totalCents, sports.inCents]).toEqual([8000, 8000]);
  });
});

describe("one merchant's summary agrees with the strip of its transaction list", () => {
  it.each(SCOPES)("money paid and received are the strip's, and the months add up to the money out of the rows (%s view)", async (scope) => {
    const ctx = await contextOf(home.aino, scope);
    const names = ["KAUPPA OY", "URHEILUKAUPPA ESIMERKKI OY", "YHTEINEN KAUPPA", "K-MARKET ESIMERKKI", "NORDNET BANK AB", "ASUNTO OY ESIMERKKI", "TUNTEMATON PUOTI 123"];
    const mismatches: string[] = [];
    for (const counterparty of names) {
      const merchant = merchantOf(ctx, counterparty);
      const { summary } = await get(home.aino, `/api/merchants/summary?merchant=${encodeURIComponent(merchant)}&scope=${scope}`);
      const strip = await get(home.aino, `/api/transactions?merchant=${encodeURIComponent(merchant)}&scope=${scope}&limit=1`);
      if (summary.outCents !== strip.outCents) mismatches.push(`${merchant}: summary out ${summary.outCents}, strip ${strip.outCents}`);
      if (summary.inCents !== strip.inCents) mismatches.push(`${merchant}: summary in ${summary.inCents}, strip ${strip.inCents}`);
      // the months are the money out before refunds, so a merchant with money back has the refund more in them
      const refunded = ctx.txs.filter((t) => t.merchant === merchant && !t.isTransfer && t.amountCents > 0 && t.flows.income === 0).reduce((n, t) => n + Math.abs(t.flows.consumption), 0);
      if (summary.year.outCents - refunded !== summary.outCents) mismatches.push(`${merchant}: twelve months ${summary.year.outCents} less refunds ${refunded}, summary out ${summary.outCents}`);
      const sumOfMonths = (summary.months as { outCents: number }[]).reduce((n, m) => n + m.outCents, 0);
      if (sumOfMonths !== summary.year.outCents) mismatches.push(`${merchant}: months ${sumOfMonths}, year ${summary.year.outCents}`);
    }
    expect(mismatches.join("\n")).toBe("");
  });
});

describe("the list of what nothing recognised adds up to its rows", () => {
  it.each(SCOPES)("its total is the spending of the rows nothing categorised, and its merchants add up to it (%s view)", async (scope) => {
    const ctx = await contextOf(home.aino, scope);
    const unknown = await get(home.aino, `/api/merchants/uncategorised?scope=${scope}`);
    const rows = ctx.txs.filter((t) => t.amountCents < 0 && t.categorySource === "default" && t.category === "other" && !t.isTransfer && t.flows.consumption > 0);
    expect(rows.length).toBeGreaterThan(0);
    expect(unknown.totalCents).toBe(rows.reduce((n, t) => n + t.flows.consumption, 0));
    expect(unknown.count).toBe(new Set(rows.map((t) => t.merchant)).size);
    expect((unknown.items as { totalCents: number }[]).reduce((n, m) => n + m.totalCents, 0)).toBe(unknown.totalCents);
  });
});
