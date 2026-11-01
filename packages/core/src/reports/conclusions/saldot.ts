// Decision: whether the household's net worth is growing, and which account holds the money
import { type Language, localeOf } from "../../locale.ts";
import { messageIn } from "../../messages.ts";
import { formatEur } from "../../analysis/format.ts";
import type { Conclusion, ConclusionInput } from "../conclusion.ts";
import { compareFigure, conclusionOf, noComparisons, sumRows } from "./shared.ts";

/** A balance in another currency: the amount and the code, no conversion. */
const formatForeign = (f: { currency: string; cents: number }, lang: Language) => `${(f.cents / 100).toLocaleString(localeOf(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${f.currency}`;

/** What the accounts hold at the end of the period less the debts no account holds (`accountsLessDebt`): the accounts are the rows, the debts the last one. Null with no month that has a figure. */
export function balancesConclusion(input: ConclusionInput): Conclusion | null {
  const { read, lang } = input;
  const report = read("balances");
  // the latest month with a figure after the debts no account holds; with none (a saved loan's balance is not told yet) the accounts alone are the figure
  const known = report.accountsLessDebt.findLastIndex((v) => v !== null);
  const debtsKnown = known >= 0;
  const series = debtsKnown ? report.accountsLessDebt : report.total;
  const last = debtsKnown ? known : report.total.findLastIndex((v) => v !== null);
  const net = last >= 0 ? series[last]! : null;
  if (net === null) return null;
  const accounts = report.accounts.flatMap((a) => (a.values[last] === null ? [] : [{ label: a.name, cents: a.values[last]! }]));
  // cards and loan accounts carry the bank's sign, so the money on the savings and checking accounts is told apart from what they owe
  const owing = report.accounts.flatMap((a) => (a.type === "credit_card" || a.type === "loan") && a.values[last] !== null ? [a.values[last]!] : []);
  const owedCents = -owing.reduce((s, v) => s + v, 0);
  const cashCents = sumRows(accounts) + owedCents;
  const debt = net - sumRows(accounts);
  const rows = debt === 0 ? accounts : [...accounts, { label: messageIn(lang, "rep.balances_debts"), cents: debt }];
  const { compare, gaps } = noComparisons(lang);
  const before = last >= 1 ? (series[last - 1] ?? null) : null;
  if (before === null) gaps.previous = messageIn(lang, "rep.balances_no_previous");
  else compare.previous = compareFigure("previous", messageIn(lang, "rep.prev_month"), before, net - before, lang);
  gaps.expected = messageIn(lang, "rep.balances_no_expected");
  gaps.yearAgo = messageIn(lang, "rep.balances_no_year");
  const grew = before === null ? "" : net >= before ? ` ${messageIn(lang, "rep.balances_grew", { amount: formatEur(net - before, false, lang) })}` : ` ${messageIn(lang, "rep.balances_shrank", { amount: formatEur(before - net, false, lang) })}`;
  // an account in no figure is named with what is known of it, never added to the euros
  const left = report.missing.map((m) => (m.foreign ? `${m.name} (${formatForeign(m.foreign, lang)})` : messageIn(lang, "rep.balances_unknown", { name: m.name })));
  const missingText = left.length === 0 ? "" : ` ${messageIn(lang, "rep.balances_missing", { names: left.join(", ") })}`;
  return conclusionOf("saldot", input, {
    question: messageIn(lang, "rep.balances_question"),
    figure: { label: messageIn(lang, "rep.net_worth"), cents: net },
    explanation: `${messageIn(lang, "rep.balances_total", { amount: formatEur(cashCents, false, lang) })}${owedCents > 0 ? ` ${messageIn(lang, "rep.balances_cards", { amount: formatEur(owedCents, false, lang), net: formatEur(sumRows(accounts), false, lang) })}` : ""}${debt === 0 ? "" : ` ${messageIn(lang, "rep.balances_less_debt", { amount: formatEur(-debt, false, lang) })}`}${debtsKnown ? "" : ` ${messageIn(lang, "rep.balances_debts_unknown")}`}${grew}${missingText}`,
    compare,
    gaps,
    basis: {
      method: messageIn(lang, "rep.balances_method"),
      rows,
      accounts: report.accounts.map((a) => ({ id: a.accountId, name: a.name })),
    },
  });
}
