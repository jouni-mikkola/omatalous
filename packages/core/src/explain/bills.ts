/**
 * The figures of Laskut told by their rows. The fixed costs and the subscriptions of a month are estimates of series:
 * each series is told by its latest charge, the row
 * whose payee and sum the estimate repeats, with the series' cents for the figure (and the bank's sum of the row as `whole`
 * where the two differ). In a member's view of a joint account the series is the viewer's part, so the line says its part
 * (`part.use`) and the account's whole sum beside it. A series with several rows in a figure is one line. The figure is the
 * total's own number. A line whose cents are not the bank's sum or the household's part of it says why: a bill that comes
 * every N months counts 1/N of it (`bill.spread`), and any other difference is the usual sum of the series (`bill.usual`).
 */
import { billCents, partCents } from "../account-use.ts";
import type { AnalysisContext, AnalysisTx } from "../analysis/context.ts";
import { fixedMonthlyCents, isCancelled, isFixedCost, isSubscription, subscriptionsMonthlyCents } from "../commitments.ts";
import { getCategory } from "../categories.ts";
import type { RecurringSeries } from "../recurring.ts";
import { cadenceMonths } from "../recurring-cadence.ts";
import type { BillFigureId, ExplainArgs, Explanation, Line, Reason } from "./types.ts";

const NO_REASONS: readonly Reason[] = [];

/** The series' newest charge in the view: what an estimate of it repeats. */
function latestCharge(s: RecurringSeries, byId: ReadonlyMap<string, AnalysisTx>): AnalysisTx | undefined {
  let latest: AnalysisTx | undefined;
  for (const id of s.transactionIds) {
    const t = byId.get(id);
    if (t && t.amountCents < 0 && (!latest || t.bookingDate >= latest.bookingDate)) latest = t;
  }
  return latest;
}

/**
 * Why a series' month is not the bank's sum of its latest charge, `whole`, less the household's part of it: a bill that comes
 * every N months counts 1/N of it; a difference beyond rounding is the series' usual sum. Nothing when the cents are that part.
 */
function monthReasons(s: RecurringSeries, cents: number, whole: number, part: Reason | undefined): Reason[] {
  const base = part ? partCents(whole, { from: Number(part.from), to: Number(part.to), of: Number(part.of) }) : whole;
  const months = cadenceMonths(s.intervalDays) ?? 1;
  if (Math.abs(cents - Math.round(base / months)) > months) return [{ rule: "bill.usual" }];
  return months > 1 ? [{ rule: "bill.spread", months }] : [];
}

export function explainBills(figure: BillFigureId, ctx: AnalysisContext, args: ExplainArgs): Explanation {
  const cancelled = args.cancelled ?? new Set<string>();
  const byId = new Map(ctx.txs.map((t) => [t.id, t]));
  const lines = new Map<string, Line>();
  const add = (s: RecurringSeries, t: AnalysisTx, cents: number, whole: number) => {
    const had = lines.get(t.id);
    if (had) {
      had.cents += cents;
      return;
    }
    const why = (args.why?.of(t.id) ?? NO_REASONS).filter((r) => r.rule === "part.use");
    const differs = whole !== cents;
    lines.set(t.id, { id: t.id, day: t.bookingDate, cents, ...(differs ? { whole } : {}), why: differs ? [...why, ...monthReasons(s, cents, whole, why[0])] : why });
  };
  const estimateOf = (s: RecurringSeries, cents: number) => {
    const t = latestCharge(s, byId);
    if (t) add(s, t, cents, -billCents(t));
  };
  const counts = figure === "bills.subs" ? isSubscription : (s: RecurringSeries) => isFixedCost(s) && ["expense", "debt"].includes(getCategory(s.category).kind);
  for (const s of ctx.recurring) if (counts(s) && !isCancelled(cancelled, s)) estimateOf(s, s.monthlyCents);
  const cents = figure === "bills.subs" ? subscriptionsMonthlyCents(ctx.recurring, cancelled) : fixedMonthlyCents(ctx.recurring, cancelled);
  const out = [...lines.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1));
  return { figure, kind: "sum", cents, lines: out, check: { kind: "sum", diffCents: cents - out.reduce((n, l) => n + l.cents, 0) } };
}
