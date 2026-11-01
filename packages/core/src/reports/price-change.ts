// Decision: whether the household's own fixed prices rose faster than prices in general, and so whether to renegotiate or change provider rather than accept the rise
import { cancelledSubjects, isCancelled, isFixedCost } from "../commitments.ts";
import { addMonths, monthEnd, monthOf, monthRange } from "../dates.ts";
import { PRICE_CHANGE_MONTHS } from "../thresholds.ts";
import { getCategory } from "../categories.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import type { IsoDate, PriceIndex, UserInputs } from "../types.ts";

/**
 * `no_index`: the admin has not let the server fetch the published series (or it has not arrived yet).
 * `short_index`: the series has a gap in the window, or does not reach the last complete months.
 * `no_basket`: the household has no fixed-price service that existed at the start of the window.
 */
type PriceChangeStatus = "ok" | "no_index" | "short_index" | "no_basket";

export interface PriceChangeMonth {
  month: string;
  /** The household's own series: what the basket costs in this month, in cents. */
  ownCents: number;
  /** The published index points of this month. */
  indexPoints: number;
  /** Own series and the index, each as `value / value of the base month`. */
  ownRatio: number;
  indexRatio: number;
  /** The household's series divided by the published series: `ownRatio / indexRatio`. Over 1 means the household's prices rose faster. */
  relative: number;
}

export interface PriceChangeService {
  id: string;
  merchant: string;
  /** The service's price in the base month and in the last month, cents per charge. */
  fromCents: number;
  toCents: number;
}

interface PriceChangeReport {
  status: PriceChangeStatus;
  /** Where the index comes from; null while there is none. */
  source: { name: string; table: string; fetchedAt: IsoDate } | null;
  baseMonth: string | null;
  lastMonth: string | null;
  months: PriceChangeMonth[];
  /** The change over the window as fractions (0.05 is 5 %): the household's series, the index, and the ratio of the two less one. */
  ownChange: number | null;
  indexChange: number | null;
  relativeChange: number | null;
  /** The services of the basket, largest rise first. */
  services: PriceChangeService[];
}

const none = (status: PriceChangeStatus, index: PriceIndex | null | undefined): PriceChangeReport => ({
  status,
  source: index ? { name: index.source, table: index.table, fetchedAt: index.fetchedAt } : null,
  baseMonth: null,
  lastMonth: null,
  months: [],
  ownChange: null,
  indexChange: null,
  relativeChange: null,
  services: [],
});

/**
 * The household's own price change against the published consumer price index. The own series is a fixed basket of the
 * services that charge a fixed price (`isFixedCost` of kind subscription, spending and not debt, not marked as
 * cancelled) and that already charged in the base month: the basket costs, month by month, each service's price in
 * force then times its charges a month. Quantities stay the same, so only price moves the series. It is built from
 * the recurring series the fixed costs page reads (ADR 0004), and the published series arrives as a parameter
 * (`inputs.priceIndex`): core fetches nothing. Services that ended inside the window are not in the basket, and the
 * page says so.
 */
export function priceChangeReport(ctx: AnalysisContext, inputs: UserInputs): PriceChangeReport {
  const index = inputs.priceIndex ?? null;
  if (!index) return none("no_index", null);
  // the last complete month the publisher has a figure for: the index comes out weeks after the month
  let last = addMonths(monthOf(ctx.today), -1);
  const earliest = addMonths(last, -24);
  while (last > earliest && !(last in index.months)) last = addMonths(last, -1);
  const base = addMonths(last, -PRICE_CHANGE_MONTHS);
  const window = monthRange(base, last);
  if (window.some((m) => !isPoint(index.months[m]))) return { ...none("short_index", index), baseMonth: base, lastMonth: last };

  const cancelled = cancelledSubjects(inputs, ctx.today);
  const basket = ctx.recurring
    .filter((s) => isFixedCost(s) && s.kind === "subscription" && getCategory(s.category).kind === "expense" && !isCancelled(cancelled, s) && s.firstDate <= monthEnd(base))
    .map((s) => ({ s, steps: s.priceSteps ?? [{ date: s.firstDate, cents: s.typicalAmountCents }] }));
  const priceAt = (steps: readonly { date: IsoDate; cents: number }[], month: string): number => {
    const day = monthEnd(month);
    let cents = steps[0]!.cents;
    for (const step of steps) if (step.date <= day) cents = step.cents;
    return cents;
  };
  const cost = (month: string) => basket.reduce((sum, { s, steps }) => sum + priceAt(steps, month) * s.perMonth, 0);
  const baseCost = cost(base);
  if (!basket.length || baseCost <= 0) return { ...none("no_basket", index), baseMonth: base, lastMonth: last };

  const baseIndex = index.months[base]!;
  const months = window.map((month): PriceChangeMonth => {
    const own = cost(month);
    const indexPoints = index.months[month]!;
    const ownRatio = own / baseCost;
    const indexRatio = indexPoints / baseIndex;
    return { month, ownCents: Math.round(own), indexPoints, ownRatio, indexRatio, relative: ownRatio / indexRatio };
  });
  const end = months[months.length - 1]!;
  return {
    status: "ok",
    source: { name: index.source, table: index.table, fetchedAt: index.fetchedAt },
    baseMonth: base,
    lastMonth: last,
    months,
    ownChange: end.ownRatio - 1,
    indexChange: end.indexRatio - 1,
    relativeChange: end.relative - 1,
    services: basket
      .map(({ s, steps }) => ({ id: s.id, merchant: s.merchant, fromCents: priceAt(steps, base), toCents: priceAt(steps, last) }))
      .sort((a, b) => b.toCents / b.fromCents - a.toCents / a.fromCents || a.merchant.localeCompare(b.merchant)),
  };
}

const isPoint = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
