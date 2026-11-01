// Decision: which fixed cost or subscription to cancel or renegotiate
import { type OverlapGroup, overlapGroups, type ServiceType } from "../analysis/alerts.ts";
import { type AnalysisContext, recurringAt } from "../analysis/context.ts";
import { fixedSeriesAt } from "../analysis/fixed-share.ts";
import type { DateRange } from "../analysis/period.ts";
import { stoppedPayments } from "../analysis/insights/stopped.ts";
import { getCategory } from "../categories.ts";
import { cancelledSubjects, isCancelled, isFixedCost } from "../commitments.ts";
import { addMonthsToDate } from "../dates.ts";
import { CADENCES, SEMIMONTHLY } from "../recurring-cadence.ts";
import { priceChangeYearlyCents, type RecurringSeries } from "../recurring.ts";
import type { IsoDate, UserInputs } from "../types.ts";

interface FixedCostRow {
  id: string;
  merchant: string;
  category: string;
  /** A loan instalment: debt service, not a price. */
  debt: boolean;
  monthlyCents: number;
  /** Twelve months of `monthlyCents`, so the yearly column adds up the same way as the monthly one. */
  yearlyCents: number;
}

interface FixedPriceChange {
  id: string;
  merchant: string;
  date: IsoDate;
  fromCents: number;
  toCents: number;
  /** Charges in a year the change applies to (12 for a monthly series; a day care fee pays 11). */
  charges: number;
  /** (to - from) × charges: what the change adds to a year, negative for a cut. */
  yearlyEffectCents: number;
  debt: boolean;
}

interface FixedOverlap {
  /** The kind of service; the page names it (`rpt.fc_kind_<type>`). */
  type: ServiceType;
  merchants: string[];
  monthlyCents: number;
}

interface FixedEnded {
  merchant: string;
  lastDate: IsoDate;
  /** What it cost a month before it stopped: what the household no longer pays. */
  monthlyCents: number;
  yearlyCents: number;
}

interface FixedCostsReport {
  /** Largest first. Spending and loan instalments of the series running on the last day; a series marked as cancelled is not among them. */
  rows: FixedCostRow[];
  monthlyCents: number;
  yearlyCents: number;
  /** Price changes of the rows in the 12 months up to the last day, latest first. */
  priceChanges: FixedPriceChange[];
  /** The price changes of prices, loan instalments apart: a smaller instalment is no cheaper price. */
  priceYearlyEffectCents: number;
  /** Services of one kind from two or more brands. */
  overlaps: FixedOverlap[];
  /** Subscriptions and bills that stopped, as the stopped-payment insight tells them (within MAX_STOPPED_DAYS of the last day), latest first. */
  ended: FixedEnded[];
  endedMonthlyCents: number;
  endedYearlyCents: number;
}

const chargesOf = (s: RecurringSeries): number => {
  const def = s.cadence === "semimonthly" ? SEMIMONTHLY : CADENCES.find((c) => c.id === s.cadence)!;
  return s.perMonth ? s.perMonth * 12 : def.perYear;
};

/** The fixed costs a month on the last day of the range, the price changes among them, overlapping services and those that ended. */
export function fixedCostsReport(ctx: AnalysisContext, range: DateRange, inputs: UserInputs): FixedCostsReport {
  const end = range.to < ctx.today ? range.to : ctx.today;
  const cancelled = cancelledSubjects(inputs, end);
  const running = fixedSeriesAt(ctx, end).filter((s) => isFixedCost(s) && !isCancelled(cancelled, s) && ["expense", "debt"].includes(getCategory(s.category).kind));
  const rows = running
    .map((s) => ({ id: s.id, merchant: s.merchant, category: s.category, debt: getCategory(s.category).kind === "debt", monthlyCents: s.monthlyCents, yearlyCents: s.monthlyCents * 12 }))
    .sort((a, b) => b.monthlyCents - a.monthlyCents || a.merchant.localeCompare(b.merchant, "fi"));
  const monthlyCents = rows.reduce((s, r) => s + r.monthlyCents, 0);

  const yearAgo = addMonthsToDate(end, -12);
  const priceChanges = running
    .filter((s) => s.priceChange && s.cadence && s.priceChange.date >= yearAgo && s.priceChange.date <= end)
    .map((s) => ({
      id: s.id,
      merchant: s.merchant,
      date: s.priceChange!.date,
      fromCents: s.priceChange!.fromCents,
      toCents: s.priceChange!.toCents,
      charges: chargesOf(s),
      yearlyEffectCents: priceChangeYearlyCents(s)!,
      debt: getCategory(s.category).kind === "debt",
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.yearlyEffectCents - a.yearlyEffectCents);

  const overlaps = overlapGroups(recurringAt(ctx, end))
    .map((g: OverlapGroup) => {
      const live = g.matched.filter((m) => !isCancelled(cancelled, m.s));
      return { type: g.type, merchants: [...new Set(live.map((m) => m.s.merchant))], monthlyCents: live.reduce((s, m) => s + m.s.monthlyCents, 0), brands: new Set(live.map((m) => m.brand)).size };
    })
    .filter((g) => g.brands >= 2)
    .map(({ brands: _brands, ...g }) => g);

  const ended = stoppedPayments({ ctx, end, gateMonthlyCents: 0 })
    .flatMap((i) => (i.fact.type === "stopped" ? [{ merchant: i.fact.merchant, lastDate: i.fact.lastDate, monthlyCents: i.fact.monthlyCents, yearlyCents: i.fact.monthlyCents * 12 }] : []))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));

  return {
    rows,
    monthlyCents,
    yearlyCents: monthlyCents * 12,
    priceChanges,
    priceYearlyEffectCents: priceChanges.filter((p) => !p.debt).reduce((s, p) => s + p.yearlyEffectCents, 0),
    overlaps,
    ended,
    endedMonthlyCents: ended.reduce((s, e) => s + e.monthlyCents, 0),
    endedYearlyCents: ended.reduce((s, e) => s + e.yearlyCents, 0),
  };
}
