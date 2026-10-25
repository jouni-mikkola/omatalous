/**
 * A made-up household whose credit card begins in the middle of the history: a checking account with pay, rent and
 * the card's bills, and a connected card with the groceries and restaurants of the months since. Before `cardSince`
 * the bank gives no card rows, so the same purchases are in the history only as one card bill a month from the
 * checking account (`before_history`). The test of "vertailu vain kun data kattaa": the comparison with the usual
 * month must say nothing while the months to compare hold those bills.
 */
import { createContext } from "../src/analysis/context.ts";
import { addMonths, dateIn } from "../src/dates.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

export const LATE_CARD_TODAY = "2026-10-09";
export const lateCardAccounts: Account[] = [
  { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" },
  { id: "card", name: "Esimerkki Gold", bank: "Resurs Bank", iban: null, currency: "EUR", type: "credit_card" },
];

const row = (id: string, accountId: string, bookingDate: string, amountCents: number, counterparty: string, description: string | null = null): Transaction =>
  tx({ id, accountId, bookingDate, amountCents, counterparty, description, merchant: normalizeMerchant(counterparty, description) });

/** January 2026 to the 9th of the month of `today`; the card's own rows begin in `cardSince` (`2026-07`). `billsBefore` false leaves the bills of the months before out: the card's history is then missing with nothing to say so. */
export function lateCardContext(cardSince = "2026-07", today = LATE_CARD_TODAY, billsBefore = true) {
  const out: Transaction[] = [];
  for (let m = "2026-01", i = 0; m <= today.slice(0, 7); m = addMonths(m, 1), i++) {
    const own = m >= cardSince;
    out.push(row(`rent-${i}`, "chk", dateIn(m, 2), -90_000, "ASUNTO OY ESIMERKKI", "VUOKRA"));
    out.push(row(`pay-${i}`, "chk", dateIn(m, 1), 300_000, "ESIMERKKI OY", "PALKKA"));
    if (own) {
      out.push(row(`food-${i}`, "card", dateIn(m, 3), -40_000, "K-MARKET ESIMERKKI"));
      out.push(row(`dine-${i}`, "card", dateIn(m, 8), -12_000, "RAVINTOLA ESIMERKKI"));
    }
    if (m < today.slice(0, 7)) {
      // the bill is paid from checking; with the card's rows it pairs with the card's payment row, without them it stands alone
      if (own || billsBefore) out.push(row(`bill-${i}`, "chk", dateIn(m, 14), -52_000, "RESURS BANK AB", "KORTTILASKU"));
      if (own) out.push(row(`paid-${i}`, "card", dateIn(m, 14), 52_000, "SUORITUS", "SUORITUS"));
    }
  }
  return createContext(enrichTransactions(out, lateCardAccounts, []), lateCardAccounts, today);
}
