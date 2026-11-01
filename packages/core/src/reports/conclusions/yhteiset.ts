// Decision: who owes whom on the joint accounts, from what the joint accounts cost
import { spendRows } from "../../analysis/context.ts";
import { formatEur } from "../../analysis/format.ts";
import { toDayRange } from "../../analysis/period.ts";
import { messageIn } from "../../messages.ts";
import type { BalanceInput } from "../../types.ts";
import type { Conclusion, ConclusionInput } from "../conclusion.ts";
import { conclusionOf, earlierNames, noComparisons, spanOf, spendingComparisons } from "./shared.ts";

/** A joint account: two or more of the household use it. */
const isJointAccount = (a: BalanceInput): boolean => (a.use?.users.filter((u) => u.weight > 0).length ?? 0) >= 2;

/** What the joint accounts cost in the period, each account as a row. Null when the household has no joint account. */
export function sharedConclusion(input: ConclusionInput): Conclusion | null {
  const { ctx, range, balances, lang } = input;
  const joint = balances.filter(isJointAccount);
  if (!joint.length) return null;
  const ids = new Set(joint.map((a) => a.id));
  const span = spanOf(ctx, range);
  const byAccount = new Map<string, number>();
  for (const t of spendRows(ctx, toDayRange(span))) {
    if (ids.has(t.accountId)) byAccount.set(t.accountId, (byAccount.get(t.accountId) ?? 0) + t.flows.consumption + t.flows.debt);
  }
  const rows = joint.map((a) => ({ label: a.name, cents: byAccount.get(a.id) ?? 0 })).filter((r) => r.cents !== 0);
  const total = rows.reduce((s, r) => s + r.cents, 0);
  const compared = spendingComparisons(ctx, span, earlierNames(lang), lang, ids);
  const { gaps } = noComparisons(lang);
  return conclusionOf("yhteiset", input, {
    question: messageIn(lang, "rep.shared_question"),
    figure: { label: messageIn(lang, "rep.shared_figure"), cents: total },
    explanation: messageIn(lang, "rep.shared_explain", { amount: formatEur(total, false, lang) }),
    compare: compared.compare,
    gaps: { ...compared.gaps, expected: messageIn(lang, "rep.shared_no_expected"), budget: gaps.budget },
    basis: {
      method: messageIn(lang, "rep.shared_method"),
      rows,
      accounts: joint.map((a) => ({ id: a.id, name: a.name })),
    },
  }, input.range, ids);
}
