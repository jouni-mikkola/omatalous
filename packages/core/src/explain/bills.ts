/**
 * The figures of Laskut told by their rows. A paid bill is the row that paid it. A coming or missing bill, the fixed
 * costs and the subscriptions of a month are estimates of series: each series is told by its latest charge, the row
 * whose payee and sum the estimate repeats, with the series' cents for the figure (and the row's own sum as `whole` where
 * the two differ). A series with several rows in a figure is one line. The figure is the board's or the total's own number.
 */
import { billMonth, type BillBoardRow } from "../analysis/bill-month.ts";
import type { AnalysisContext, AnalysisTx } from "../analysis/context.ts";
import { fixedMonthlyCents, isCancelled, isFixedCost, isSubscription, subscriptionsMonthlyCents } from "../commitments.ts";
import { getCategory } from "../categories.ts";
import { monthOf } from "../dates.ts";
import type { RecurringSeries } from "../recurring.ts";
import type { BillFigureId, ExplainArgs, Explanation, Line } from "./types.ts";

const STATE = { "bills.paid": "paid", "bills.coming": "coming", "bills.missing": "missing" } as const;
const TOTAL = { "bills.paid": "paidCents", "bills.coming": "comingCents", "bills.missing": "missingCents", "bills.due": "dueCents" } as const;

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
  const series = new Map(ctx.recurring.map((s) => [s.id, s]));
  const lines = new Map<string, Line>();
  const add = (t: AnalysisTx, cents: number, whole: number | null) => {
    const had = lines.get(t.id);
    if (had) had.cents += cents;
    else lines.set(t.id, { id: t.id, day: t.bookingDate, cents, ...(whole !== null && whole !== cents ? { whole } : {}), why: [] });
  };
  const estimateOf = (s: RecurringSeries | undefined, cents: number) => {
    const t = s && latestCharge(s, byId);
    if (t) add(t, cents, -t.amountCents);
  };
  let cents: number;
  if (figure === "bills.fixed" || figure === "bills.subs") {
    const counts = figure === "bills.subs" ? isSubscription : (s: RecurringSeries) => isFixedCost(s) && ["expense", "debt"].includes(getCategory(s.category).kind);
    for (const s of ctx.recurring) if (counts(s) && !isCancelled(cancelled, s)) estimateOf(s, s.monthlyCents);
    cents = figure === "bills.subs" ? subscriptionsMonthlyCents(ctx.recurring, cancelled) : fixedMonthlyCents(ctx.recurring, cancelled);
  } else {
    const board = billMonth(ctx, monthOf(args.range.from), cancelled);
    const state = figure === "bills.due" ? null : STATE[figure];
    const rows = board.rows.filter((r: BillBoardRow) => state === null || r.state === state);
    for (const r of rows) {
      const paid = r.txId ? byId.get(r.txId) : undefined;
      if (paid) add(paid, r.cents, null);
      else estimateOf(series.get(r.seriesId), r.cents);
    }
    cents = board.totals[TOTAL[figure]];
  }
  const out = [...lines.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1));
  return { figure, kind: "sum", cents, lines: out, check: { kind: "sum", diffCents: cents - out.reduce((n, l) => n + l.cents, 0) } };
}
