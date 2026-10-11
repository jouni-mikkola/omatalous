/**
 * Spending insight from the spending change (H-insights candidate 12): the grocery basket by price or visits. The
 * category that moved most against a year earlier is told by the report's year view; as an insight it fired on the
 * ordinary drift of almost every household.
 */
import { daysInMonth } from "../../dates.ts";
import { spendingChange } from "../change.ts";
import { changeMonths, signed } from "../change-text.ts";
import type { AnalysisContext } from "../context.ts";
import type { DateRange } from "../period.ts";
import type { Insight, InsightSource } from "./types.ts";

const lastDay = (m: string) => `${m}-${String(daysInMonth(m)).padStart(2, "0")}`;

const GROCERY_MIN_VISITS = 8;
const GROCERY_MIN_SAME_SHOPS = 0.7;

/** Candidate 12, the grocery basket: price or visits, from the year view or else the season view. */
export function spendingInsights(ctx: AnalysisContext, range: DateRange): Insight[] {
  const { month, lastComplete } = changeMonths(ctx, range);
  const c = spendingChange(ctx, "year", lastComplete) ?? spendingChange(ctx, "season", lastComplete === month ? month : lastComplete);
  if (!c || c.running) return [];
  const k = c.target.months.length;
  const monthly = (cents: number) => Math.round(cents / k);
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
      if (Math.max(Math.abs(priceCents), Math.abs(volumeCents)) >= c.gateCents) {
        const byPrice = Math.abs(priceCents) >= Math.abs(volumeCents);
        const title = byPrice ? `Ruokakaupan ostoskerta ${Math.abs(ticketPct)} % ${priceCents > 0 ? "kalliimpi" : "halvempi"}` : `Ruokakaupassa käyntejä ${Math.abs(visitPct)} % ${volumeCents > 0 ? "enemmän" : "vähemmän"}`;
        const changeCents = priceCents + volumeCents;
        out.push({
          id: "spending-groceries",
          tone: "info",
          title,
          detail: `${Math.round(now / k)} käyntiä kuussa, vuotta aiemmin ${Math.round(base / k)}, samoissa kaupoissa. Ostoskerta ${signed(monthly(priceCents))}, käyntien määrä ${signed(monthly(volumeCents))} kuussa.`,
          yearlyCents: Math.round((Math.abs(changeCents) / k) * 12),
          direction: changeCents < 0 ? -1 : 1,
          link: { category: "groceries", from: `${c.target.months[0]}-01`, to: lastDay(c.target.months[k - 1]!) },
        });
      }
    }
  }
  return out;
}

export const spendingChanges: InsightSource = (a) => spendingInsights(a.ctx, a.range);
