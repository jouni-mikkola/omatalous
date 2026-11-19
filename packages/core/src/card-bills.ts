import { isInstalments, referenceOf, varyingRows } from "./card-channel.ts";
import { fold } from "./merchant.ts";
import { median } from "./stats.ts";
import { namesCard } from "./transfers.ts";
import type { Account, Transaction } from "./types.ts";
import { isCardIssuerBankText, isCardIssuerText, isLoanText } from "./wording.ts";

/**
 * Before transfer detection: a card bill pairs with the connected card's payment row. An issuer that also lends is paid
 * a card bill only where the payment names a connected card of the issuer: its name alone, or a sum that changes, tells
 * no card, and such a payment stays a credit of unknown kind (loans), whose kind Tarkistettavat asks.
 */
export function applyCardBills(next: readonly Transaction[], byUserRule: ReadonlySet<string>, accounts: readonly Account[]): void {
  const cards = accounts.filter((a) => a.type === "credit_card");
  if (!cards.length) return;
  const rows = next.filter((t) => !byUserRule.has(t.id));
  for (const t of [...cardBillsByAmount(rows), ...issuerBills(rows)]) {
    const payee = [t.merchant, t.counterparty].filter(Boolean).join(" ");
    if (cards.some((card) => namesCard(payee, card))) t.category = "card_bill";
  }
}

/** Payments to a bank that issues cards and lends, by its name alone: a card bill where a connected card of it is named, at any sum. */
const issuerBills = (txs: readonly Transaction[]): Transaction[] =>
  txs.filter((t) => {
    if (t.category !== "loans" || t.categorySource !== "rule" || t.amountCents >= 0) return false;
    const text = fold([t.merchant, t.counterparty, t.description].filter(Boolean).join(" | "));
    return isCardIssuerBankText(text) && !isLoanText(text);
  });

/**
 * Payments to a card issuer that a rule called "loans" but whose amounts
 * jump from month to month: a card's bill, not an instalment, where a connected
 * card of the issuer is named (`applyCardBills`). An amount paid
 * three times or more is an instalment and stays a loan, so a car loan and a
 * card bill from the same issuer are told apart.
 *
 * One reference is one contract, so the payments under it share the answer: where at least half of them are equal
 * instalments, an extra payment and an instalment that changed are the same loan's, and where most vary, the equal
 * ones are that card's bills too. A reference seen once or twice is an invoice's own number and says nothing: its
 * rows are judged with the ones that have none, each by its amount as before.
 */
function cardBillsByAmount(txs: readonly Transaction[]): Transaction[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.category !== "loans" || t.categorySource !== "rule" || t.amountCents >= 0) continue;
    const text = fold([t.merchant, t.counterparty, t.description].filter(Boolean).join(" | "));
    if (!isCardIssuerText(text) || isLoanText(text)) continue;
    const key = `${t.accountId}|${t.merchant}`;
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }
  const bills: Transaction[] = [];
  for (const rows of groups.values()) {
    const byReference = new Map<string, Transaction[]>();
    for (const t of rows) {
      const reference = referenceOf(t);
      const same = byReference.get(reference);
      if (same) same.push(t);
      else byReference.set(reference, [t]);
    }
    const rest: Transaction[] = [];
    for (const [reference, same] of byReference) {
      if (reference === "" || same.length < 3) rest.push(...same);
      else bills.push(...billsAmong(same, true));
    }
    bills.push(...billsAmong(rest, false));
  }
  return bills;
}

/** The card bills among one payee's rows: all or none of a contract's, and otherwise the ones whose amount varies. */
function billsAmong(rows: readonly Transaction[], contract: boolean): readonly Transaction[] {
  const varying = varyingRows(rows).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  if (varying.length < 3 || (contract && isInstalments(rows))) return [];
  // month-to-month change, not the overall range: a slowly shrinking instalment is not a card bill
  const changes = varying.slice(1).map((t, i) => Math.abs(t.amountCents - varying[i]!.amountCents) / Math.abs(varying[i]!.amountCents));
  if (median(changes) <= 0.1) return [];
  return contract ? rows : varying;
}
