// Decision: whether to pay a debt down first, and how much cash is left as a buffer
import { formatEur } from "../../analysis/format.ts";
import { messageIn } from "../../messages.ts";
import type { Conclusion, ConclusionInput } from "../conclusion.ts";
import { conclusionOf, largestParts, noComparisons } from "./shared.ts";

/** What the household owes today (`householdDebts`), each loan as a row, and how long the cash on the accounts would carry the expected spending. */
export function debtConclusion(input: ConclusionInput): Conclusion {
  const { balances, read, lang } = input;
  const { loans, total } = read("loans");
  const { cashCents, netCents, cardDebtCents, dueBeforePaydayCents, bufferMonths, expectedSpendCents } = read("buffer");
  const { loans: held, unsavedLoans } = read("balances").holdings;
  // loans the total cannot hold: saved or connected with no balance, or paid every month and never saved
  const missing = [...held.filter((l) => l.leftCents === null).map((l) => l.name), ...(unsavedLoans?.names ?? [])];
  const rows = largestParts(loans.map((l) => ({ label: l.name, cents: l.balance.cents ?? 0 })), total.cents, messageIn(lang, "rep.other"));
  const eur = (c: number) => formatEur(c, false, lang);
  const spoken = [cardDebtCents > 0 && messageIn(lang, "rep.debt_card", { amount: eur(cardDebtCents) }), dueBeforePaydayCents > 0 && messageIn(lang, "rep.debt_due", { amount: eur(dueBeforePaydayCents) })].filter(Boolean).join(messageIn(lang, "rep.and"));
  const buffer =
    cashCents === null || netCents === null
      ? messageIn(lang, "rep.debt_no_buffer")
      : bufferMonths === null
        ? messageIn(lang, "rep.debt_cash", { cash: eur(cashCents), spoken: spoken ? messageIn(lang, "rep.debt_spoken", { spoken }) : "" })
        : messageIn(lang, "rep.debt_cash_months", { cash: eur(cashCents), spoken: spoken ? messageIn(lang, "rep.debt_spoken", { spoken }) : "", net: eur(netCents), monthly: eur(expectedSpendCents ?? 0), months: lang === "en" ? bufferMonths.toFixed(1) : bufferMonths.toFixed(1).replace(".", ",") });
  const { compare, gaps } = noComparisons(lang);
  gaps.expected = messageIn(lang, "rep.debt_no_expected");
  gaps.previous = messageIn(lang, "rep.debt_no_earlier");
  gaps.yearAgo = messageIn(lang, "rep.debt_no_earlier");
  return conclusionOf("velat", input, {
    question: messageIn(lang, "rep.debt_question"),
    figure: { label: messageIn(lang, "rep.debt_total"), cents: total.cents },
    explanation: `${[total.cents > 0 ? messageIn(lang, "rep.debt_owed", { amount: formatEur(total.cents, false, lang) }) : missing.length === 0 && messageIn(lang, "rep.debt_none"), missing.length > 0 && messageIn(lang, missing.length === 1 ? "rep.debt_missing_one" : "rep.debt_missing_many", { names: missing.join(", ") }), buffer].filter(Boolean).join(" ")}`,
    compare,
    gaps,
    basis: {
      method: messageIn(lang, "rep.debt_method"),
      rows,
      accounts: balances.filter((a) => a.type === "credit_card" || a.type === "loan").map((a) => ({ id: a.id, name: a.name })),
    },
  });
}
