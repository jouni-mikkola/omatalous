/**
 * Muut havainnot: the insights (analysis/insights) on the page where the household answers every finding. They are
 * the running month's, judged as the overview judged them (the month up to today, with its alerts), and each keeps its
 * own gate and history rule. The page tells each euro once: an insight over half of whose rows are paid to the payees
 * of the findings, all of them together, is theirs to tell, whether a finding shows or was decided on, so it is left
 * out; so is one that the findings tell in part when the part left over is under the gate. Payees and not row ids: a
 * finding stands on complete months, an insight on today, so the newest charge is in one and not the other. Ei koske
 * meitä stores a dismissal mark (`insightDismissSubject`), and the insight returns when its figure moves 25 %.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import { answeredInsights, type Insight, insightInputOf } from "../analysis/insights/index.ts";
import type { UserInputs } from "../types.ts";
import { GATE_YEARLY_CENTS, rowsById } from "./common.ts";
import type { DismissedInsight } from "./types.ts";

/** A row of an insight as the overlap rule reads it: who was paid and how much. */
export interface PaidRow {
  payee: string;
  cents: number;
}

/**
 * The findings tell this insight: over half of its rows go to their payees (`told`, every finding's together), or some
 * do and the rest of the figure, shared out by the rows' amounts, is under the gate (rule 3).
 */
export function coveredBy(insight: Pick<Insight, "rows" | "yearlyCents">, rowOf: (row: string) => PaidRow | undefined, told: ReadonlySet<string>): boolean {
  const rows = (insight.rows ?? []).map(rowOf);
  if (!rows.length) return false;
  const isTold = (r: PaidRow | undefined): r is PaidRow => r !== undefined && told.has(r.payee);
  const ours = rows.filter(isTold);
  if (ours.length > rows.length / 2) return true;
  if (!ours.length) return false;
  const size = (list: readonly (PaidRow | undefined)[]) => list.reduce((s, r) => s + Math.abs(r?.cents ?? 0), 0);
  const all = size(rows);
  return all > 0 && (insight.yearlyCents * (all - size(ours))) / all < GATE_YEARLY_CENTS;
}

/** The insights no finding covers: shown, or dismissed while their figure stays within 25 % of the dismissed one. */
export function othersOf(ctx: AnalysisContext, inputs: UserInputs, findingRows: readonly (readonly string[])[]): { others: Insight[]; othersDismissed: DismissedInsight[] } {
  const range = { from: `${ctx.today.slice(0, 7)}-01`, to: ctx.today };
  const byId = rowsById(ctx);
  const rowOf = (id: string): PaidRow | undefined => {
    const t = byId.get(id);
    return t && { payee: t.merchant, cents: t.amountCents };
  };
  const told = new Set(findingRows.flatMap((rows) => rows.flatMap((id) => byId.get(id)?.merchant ?? [])));
  const others: Insight[] = [];
  const othersDismissed: DismissedInsight[] = [];
  for (const { insight, dismissal } of answeredInsights(insightInputOf(ctx, range, inputs))) {
    if (coveredBy(insight, rowOf, told)) continue;
    if (dismissal) othersDismissed.push({ insight, subject: dismissal.subject, markedAt: dismissal.markedAt });
    else others.push(insight);
  }
  return { others, othersDismissed };
}
