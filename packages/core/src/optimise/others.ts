/**
 * Muut havainnot: the insights (analysis/insights) on the page where the household answers every finding. They are
 * judged on the window the findings use (`areaInputOf`: the last complete months, up to 12), so the yearly figure each
 * states stands on a year and not on the first days of a month, and each keeps its own gate and history rule. The page
 * tells each euro once: an insight over half of whose rows are paid to the payees of the findings, all of them
 * together, is theirs to tell, whether a finding shows or was decided on, so it is left out; so is one that the findings
 * tell in part when the part left over is under the gate. Payees and not row ids: an insight and a finding may pick
 * different charges of one payee. Ei koske meitä stores a dismissal mark (`insightDismissSubject`), and the insight
 * returns when its figure moves 25 %.
 */
import { answeredInsights, type Insight, insightInputOf } from "../analysis/insights/index.ts";
import { GATE_YEARLY_CENTS, rowsById } from "./common.ts";
import type { AreaInput, DismissedInsight } from "./types.ts";

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
export function othersOf(a: AreaInput, findingRows: readonly (readonly string[])[]): { others: Insight[]; othersDismissed: DismissedInsight[] } {
  const { ctx } = a;
  const first = a.months[0];
  if (!first) return { others: [], othersDismissed: [] };
  const range = { from: `${first}-01`, to: a.end };
  const byId = rowsById(ctx);
  const rowOf = (id: string): PaidRow | undefined => {
    const t = byId.get(id);
    return t && { payee: t.merchant, cents: t.amountCents };
  };
  const told = new Set(findingRows.flatMap((rows) => rows.flatMap((id) => byId.get(id)?.merchant ?? [])));
  const others: Insight[] = [];
  const othersDismissed: DismissedInsight[] = [];
  // the page is read today: a renewal that is due in the next days is not a matter of the window
  for (const { insight, dismissal } of answeredInsights({ ...insightInputOf(ctx, range, a.inputs), running: true })) {
    if (coveredBy(insight, rowOf, told)) continue;
    if (dismissal) othersDismissed.push({ insight, subject: dismissal.subject, markedAt: dismissal.markedAt });
    else others.push(insight);
  }
  return { others, othersDismissed };
}
