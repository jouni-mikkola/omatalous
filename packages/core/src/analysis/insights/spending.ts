/**
 * Spending insight from the spending change (H-insights candidate 12): the grocery basket by price or visits. The
 * category that moved most against a year earlier is told by the report's year view; as an insight it fired on the
 * ordinary drift of almost every household. The ticket or the visits the title names must stand out from the
 * household's month-to-month noise (ADR 0011), and every account that pays for groceries must have rows in every
 * month compared: a card that stopped syncing is no fewer visits.
 */
import { fromMonthIndex, monthEnd, monthIndex } from "../../dates.ts";
import { spendingChange } from "../change.ts";
import { changeMonths } from "../change-text.ts";
import { GROCERY_MIN_SAME_SHOPS, GROCERY_MIN_VISITS } from "../../thresholds.ts";
import { formatEur } from "../format.ts";
import { DEFAULT_LANGUAGE, type Language } from "../../locale.ts";
import { messageIn } from "../../messages.ts";
import type { AnalysisContext, AnalysisTx } from "../context.ts";
import type { DateRange } from "../period.ts";
import { meansApart, monthlyNoise } from "../signal.ts";
import { insightOf } from "./shared.ts";
import { type Insight, type InsightSource, q } from "./types.ts";

/** Every month from `first` to `last`, both included. */
/** "+12 %", "−3 %", "±0 %" */
const signedPct = (p: number) => (p === 0 ? "±0 %" : `${p > 0 ? "+" : "−"}${Math.abs(p)} %`);

const span = (first: string, last: string) => Array.from({ length: monthIndex(last) - monthIndex(first) + 1 }, (_, i) => fromMonthIndex(monthIndex(first) + i));

/**
 * Whether each account that paid for `rows` in half the months of a window or more has a row of any kind in every
 * month of both. A month without one is missing data (a card that stopped syncing); a card used now and then has
 * quiet months and too few visits to move the comparison.
 */
function covered(ctx: AnalysisContext, rows: readonly AnalysisTx[], windows: readonly (readonly string[])[]): boolean {
  const paid = new Set(rows.map((t) => `${t.accountId}|${t.month}`));
  const accounts = new Set(rows.map((t) => t.accountId));
  const paying = [...accounts].filter((a) => windows.some((w) => w.filter((m) => paid.has(`${a}|${monthIndex(m)}`)).length * 2 >= w.length));
  const seen = new Set(ctx.txs.map((t) => `${t.accountId}|${t.month}`));
  return paying.every((a) => windows.every((w) => w.every((m) => seen.has(`${a}|${monthIndex(m)}`))));
}

/** Visits and mean ticket of each month at the given shops; a month without visits has no ticket. */
function byMonth(rows: readonly AnalysisTx[], months: readonly string[]): { visits: number[]; tickets: number[] } {
  const at = new Map(months.map((m, i) => [monthIndex(m), i]));
  const visits = months.map(() => 0);
  const cents = months.map(() => 0);
  for (const t of rows) {
    const i = at.get(t.month);
    if (i === undefined) continue;
    visits[i]! += 1;
    cents[i]! += t.spend;
  }
  return { visits, tickets: cents.flatMap((c, i) => (visits[i] ? [c / visits[i]!] : [])) };
}

/** Candidate 12, the grocery basket: price or visits, from the year view or else the season view. */
export function spendingInsights(ctx: AnalysisContext, range: DateRange, lang: Language = DEFAULT_LANGUAGE): Insight[] {
  const { month, lastComplete } = changeMonths(ctx, range);
  const c = spendingChange(ctx, "year", lastComplete) ?? spendingChange(ctx, "season", lastComplete === month ? month : lastComplete);
  if (!c || c.running) return [];
  const k = c.target.months.length;
  const out: Insight[] = [];
  const g = c.categories.find((r) => r.category === "groceries");
  if (g && g.visitsNow / k >= GROCERY_MIN_VISITS && g.visitsBase / k >= GROCERY_MIN_VISITS && g.nowCents > 0 && g.baseCents > 0 && g.sameShopsNowCents / g.nowCents >= GROCERY_MIN_SAME_SHOPS && g.sameShopsBaseCents / g.baseCents >= GROCERY_MIN_SAME_SHOPS) {
    // visits and ticket of the shops visited in both periods, so a new shop does not read as more or dearer visits
    const { sameShopsVisitsNow: now, sameShopsVisitsBase: base, sameShopsNowCents: nowCents, sameShopsBaseCents: baseCents } = g;
    if (now > 0 && base > 0) {
      // Price on the visits now and volume on the base ticket, from the totals the sentence states, so a reader can check
      // them. The report's pieces split shop by shop, where a shop with one or two visits puts its whole change into
      // volume: one visit fewer then read as 115 €.
      const priceCents = Math.round(nowCents - (now * baseCents) / base);
      const volumeCents = nowCents - baseCents - priceCents;
      const ticketPct = Math.round((nowCents / now / (baseCents / base) - 1) * 100);
      const visitPct = Math.round((now / base - 1) * 100);
      const byPrice = Math.abs(priceCents) >= Math.abs(volumeCents);
      if (Math.max(Math.abs(priceCents), Math.abs(volumeCents)) >= c.gateCents && clearOfNoise(ctx, c.target.months, c.base.months, byPrice)) {
        const changeCents = priceCents + volumeCents;
        const yearly = Math.round((Math.abs(changeCents) / k) * 12);
        out.push(
          insightOf({
            lang,
            id: "spending-groceries",
            fact: { type: "groceries", byPrice, percent: byPrice ? ticketPct : visitPct, visitsPerMonth: Math.round(now / k) },
            comparison: byPrice ? { label: "yearAgoTicket", value: q.cents(Math.round(baseCents / base)) } : { label: "yearAgoVisits", value: q.count(Math.round(base / k)) },
            action: { label: "seeRows", target: { page: "transactions", filter: { category: "groceries", from: `${c.target.months[0]}-01`, to: monthEnd(c.target.months[k - 1]!) } } },
            yearlyCents: changeCents < 0 ? yearly : -yearly,
            kind: "pattern",
            link: { category: "groceries", from: `${c.target.months[0]}-01`, to: monthEnd(c.target.months[k - 1]!) },
            calc: [
              { label: messageIn(lang, "calc.visits_now"), value: String(now) },
              { label: messageIn(lang, "calc.visits_then"), value: String(base) },
              { label: messageIn(lang, "calc.visits_change"), value: signedPct(visitPct) },
              { label: messageIn(lang, "calc.purchases_now"), value: formatEur(nowCents, false, lang) },
              { label: messageIn(lang, "calc.purchases_year_ago"), value: formatEur(baseCents, false, lang) },
              { label: messageIn(lang, "calc.ticket_change"), value: signedPct(ticketPct) },
            ],
          }),
        );
      }
    }
  }
  return out;
}

/**
 * Whether the ticket (`byPrice`) or the visits at the shops of both periods stand out from the month-to-month noise of
 * every month from the first compared to the last, with every paying account covered in the months compared.
 */
function clearOfNoise(ctx: AnalysisContext, target: readonly string[], base: readonly string[], byPrice: boolean): boolean {
  const rows = ctx.txs.filter((t) => t.category === "groceries" && t.spend > 0);
  const inTarget = new Set(target.map(monthIndex));
  const inBase = new Set(base.map(monthIndex));
  const shops = (months: ReadonlySet<number>) => new Set(rows.filter((t) => months.has(t.month)).map((t) => t.merchant));
  const now = shops(inTarget);
  const then = shops(inBase);
  if (!covered(ctx, rows, [base, target])) return false;
  const same = rows.filter((t) => now.has(t.merchant) && then.has(t.merchant));
  const all = byMonth(same, span(base[0]!, target[target.length - 1]!));
  const a = byMonth(same, target);
  const b = byMonth(same, base);
  return byPrice ? meansApart(a.tickets, b.tickets, monthlyNoise(all.tickets)) : meansApart(a.visits, b.visits, monthlyNoise(all.visits));
}

export const spendingChanges: InsightSource = (a) => spendingInsights(a.ctx, a.range, a.lang);
