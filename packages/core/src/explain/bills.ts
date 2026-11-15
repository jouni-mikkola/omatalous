/**
 * The figures of Laskut told by their rows. The fixed costs and the subscriptions of a month are estimates of series:
 * each series is told by its latest charge, the row
 * whose payee and sum the estimate repeats, with the series' cents for the figure (and the bank's sum of the row as `whole`
 * where the two differ). In a member's view of a joint account the series is the viewer's part, so the line says its part
 * (`part.use`) and the account's whole sum beside it. A series with several rows in a figure is one line. The figure is the
 * total's own number.
 */
import { billCents } from "../account-use.ts";
import type { AnalysisContext, AnalysisTx } from "../analysis/context.ts";
import { fixedMonthlyCents, isCancelled, isFixedCost, isSubscription, subscriptionsMonthlyCents } from "../commitments.ts";
import { getCategory } from "../categories.ts";
import type { RecurringSeries } from "../recurring.ts";
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

export function explainBills(figure: BillFigureId, ctx: AnalysisContext, args: ExplainArgs): Explanation {
  const cancelled = args.cancelled ?? new Set<string>();
  const byId = new Map(ctx.txs.map((t) => [t.id, t]));
  const lines = new Map<string, Line>();
  const add = (t: AnalysisTx, cents: number, whole: number | null) => {
    const had = lines.get(t.id);
    if (had) had.cents += cents;
    else lines.set(t.id, { id: t.id, day: t.bookingDate, cents, ...(whole !== null && whole !== cents ? { whole } : {}), why: (args.why?.of(t.id) ?? NO_REASONS).filter((r) => r.rule === "part.use") });
  };
  const estimateOf = (s: RecurringSeries | undefined, cents: number) => {
    const t = s && latestCharge(s, byId);
    if (t) add(t, cents, -billCents(t));
  };
  const counts = figure === "bills.subs" ? isSubscription : (s: RecurringSeries) => isFixedCost(s) && ["expense", "debt"].includes(getCategory(s.category).kind);
  for (const s of ctx.recurring) if (counts(s) && !isCancelled(cancelled, s)) estimateOf(s, s.monthlyCents);
  const cents = figure === "bills.subs" ? subscriptionsMonthlyCents(ctx.recurring, cancelled) : fixedMonthlyCents(ctx.recurring, cancelled);
  const out = [...lines.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1));
  return { figure, kind: "sum", cents, lines: out, check: { kind: "sum", diffCents: cents - out.reduce((n, l) => n + l.cents, 0) } };
}
