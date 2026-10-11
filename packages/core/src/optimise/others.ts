/**
 * Muut havainnot: the insights (analysis/insights) on the page where the household answers every finding. They are
 * the running month's, judged as the overview judged them (the month up to today, with its alerts), and each keeps its
 * own gate and history rule. An insight over half of whose rows are paid to the payees of one finding is that
 * finding's to tell, whether the finding shows or was decided on, so it is left out. Payees and not row ids: a finding
 * stands on complete months, an insight on today, so the newest charge is in one and not the other. Ei koske meitä
 * stores a dismissal mark (`insightDismissSubject`), and the insight returns when its figure moves 25 %.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import { answeredInsights, type Insight, insightInputOf } from "../analysis/insights/index.ts";
import type { UserInputs } from "../types.ts";
import { rowsById } from "./common.ts";
import type { DismissedInsight } from "./types.ts";

/** Over half of the insight's rows go to the payees of one finding: the headline's overlap rule, on payees. */
export function coveredBy(insight: Pick<Insight, "rows">, payeeOf: (row: string) => string | undefined, findingPayees: readonly ReadonlySet<string>[]): boolean {
  const payees = (insight.rows ?? []).map(payeeOf);
  if (!payees.length) return false;
  return findingPayees.some((own) => payees.filter((p) => p !== undefined && own.has(p)).length > payees.length / 2);
}

/** The insights no finding covers: shown, or dismissed while their figure stays within 25 % of the dismissed one. */
export function othersOf(ctx: AnalysisContext, inputs: UserInputs, findingRows: readonly (readonly string[])[]): { others: Insight[]; othersDismissed: DismissedInsight[] } {
  const range = { from: `${ctx.today.slice(0, 7)}-01`, to: ctx.today };
  const byId = rowsById(ctx);
  const payeeOf = (id: string) => byId.get(id)?.merchant;
  const own = findingRows.map((rows) => new Set(rows.map(payeeOf).filter((p): p is string => p !== undefined)));
  const others: Insight[] = [];
  const othersDismissed: DismissedInsight[] = [];
  for (const { insight, dismissal } of answeredInsights(insightInputOf(ctx, range, inputs))) {
    if (coveredBy(insight, payeeOf, own)) continue;
    if (dismissal) othersDismissed.push({ insight, subject: dismissal.subject, markedAt: dismissal.markedAt });
    else others.push(insight);
  }
  return { others, othersDismissed };
}
