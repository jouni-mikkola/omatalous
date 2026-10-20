/**
 * The user's decisions on findings, listed under Päätetyt: done and dismissed with their state, snoozed hidden until its
 * day. A dismissed finding comes back only when it grew a lot, so one click is not undone by ordinary movement.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import { completeMonthsBefore } from "../analysis/usual.ts";
import { monthOf } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import { netCost } from "./common.ts";
import type { Baseline, Finding, FindingState, FindingStatus } from "./types.ts";

/** A dismissed finding returns when its mid grew over this share of the mid it was dismissed at... */
export const REOPEN_SHARE = 0.5;
/** ...and by over this many cents a year. */
export const REOPEN_CENTS = 10_000;

/** Months of history the default baseline stands on. */
const BASELINE_MONTHS = 6;

/** A dismissed finding's mid grew over 50 % and over 100 € since the dismissal. A deadline finding never reopens. */
export function reopens(state: Pick<FindingState, "midCents">, midCents: number | null): boolean {
  if (midCents === null) return false;
  const then = state.midCents ?? 0;
  return midCents - then > REOPEN_SHARE * then && midCents - then > REOPEN_CENTS;
}

/** Where a finding goes: shown (`active`, or `reopened` after a dismissal) or one of the stored statuses. */
export function placeOf(state: FindingState | undefined, finding: Pick<Finding, "euros">, today: IsoDate): "active" | "reopened" | FindingStatus {
  if (!state) return "active";
  switch (state.status) {
    case "done":
      return "done";
    case "snoozed":
      return state.until !== null && state.until > today ? "snoozed" : "active";
    case "dismissed":
      return reopens(state, finding.euros?.midCents ?? null) ? "reopened" : "dismissed";
  }
}

/** The rows a measure reads: a series' own rows, a merchant's, a category's, or all spending for a season without keys. */
export function measureRows(ctx: Pick<AnalysisContext, "recurring">, measure: Finding["measure"]): (t: AnalysisContext["txs"][number]) => boolean {
  const { kind, keys } = measure;
  if (kind === "none") return () => false;
  const wanted = new Set(keys);
  const seriesIds = kind === "series" ? new Set(ctx.recurring.filter((s) => wanted.has(s.id)).flatMap((s) => s.transactionIds)) : null;
  return (t) => {
    if (seriesIds) return seriesIds.has(t.id);
    if (kind === "merchants" || kind === "unit") return wanted.has(t.merchant);
    return kind === "season" && !wanted.size ? true : wanted.has(t.category);
  };
}

/**
 * The monthly sums of a measure over the given months, oldest first: what the evidence chart shows (the 12 months of
 * `yearWindow`) and what the baseline stores. Empty for a measure of kind `none`.
 */
export function measureSums(ctx: AnalysisContext, measure: Finding["measure"], months: readonly string[]): Baseline {
  if (measure.kind === "none") return [];
  const matches = measureRows(ctx, measure);
  const sums = new Map(months.map((m) => [m, 0]));
  for (const t of ctx.txs) {
    const m = monthOf(t.bookingDate);
    if (sums.has(m) && matches(t)) sums.set(m, sums.get(m)! + netCost(t));
  }
  return months.map((month) => ({ month, cents: sums.get(month)! }));
}

/**
 * The default baseline stored with Tein tämän: `measureSums` over up to six complete months before `date`. O9's
 * follow-up refines it per measure kind.
 */
export function baselineOf(ctx: AnalysisContext, finding: Pick<Finding, "measure">, date: IsoDate): Baseline {
  return measureSums(ctx, finding.measure, completeMonthsBefore(ctx, monthOf(date), BASELINE_MONTHS));
}
