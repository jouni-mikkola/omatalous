import type { AccountType, RawTransaction } from "@banking/core";
import type { EbAccount, EbBalance, EbTransaction } from "./types.ts";

export function amountToCents(amount: string): number {
  return Math.round(Number.parseFloat(amount) * 100);
}

export function mapTransaction(t: EbTransaction): RawTransaction | null {
  const status = t.status === "BOOK" ? "booked" : t.status === "PDNG" ? "pending" : null;
  const bookingDate = t.booking_date ?? t.transaction_date ?? t.value_date;
  if (!status || !bookingDate) return null;
  const out = t.credit_debit_indicator === "DBIT";
  const cents = Math.abs(amountToCents(t.transaction_amount.amount));
  const party = out ? t.creditor : t.debtor;
  const partyAccount = out ? t.creditor_account : t.debtor_account;
  const description = [...(t.remittance_information ?? []), t.note]
    .filter((x): x is string => !!x?.trim())
    .join(" ")
    .trim();
  return {
    externalId: t.entry_reference || t.transaction_id || null,
    bookingDate,
    valueDate: t.value_date ?? null,
    amountCents: out ? -cents : cents,
    currency: t.transaction_amount.currency,
    status,
    counterparty: party?.name?.trim() || null,
    counterpartyIban: partyAccount?.iban ?? null,
    description: description || t.bank_transaction_code?.description || null,
    reference: t.reference_number ?? null,
    mcc: t.merchant_category_code ?? null,
    raw: t,
  };
}

export function accountType(a: EbAccount): AccountType {
  // the bank's own type code wins: a current account's product text can mention a card
  // ("tili ja kortti"), and calling it a card account would turn its income into transfers
  if (a.cash_account_type === "LOAN") return "loan";
  // cards are identified by a masked card number (scheme CPAN) instead of an IBAN
  if (a.cash_account_type === "CARD" || a.account_id?.other?.scheme_name === "CPAN") return "credit_card";
  if (a.cash_account_type === "SVGS") return "savings";
  if (a.cash_account_type === "CACC" || a.cash_account_type === "TRAN") return "checking";
  const text = `${a.name ?? ""} ${a.product ?? ""} ${a.details ?? ""}`;
  // "Asuntolainatili": before the card words, a loan account name may also contain "luotto"
  if (/laina|loan|mortgage|asuntoluotto/i.test(text)) return "loan";
  if (/luotto|credit|kortti|card/i.test(text)) return "credit_card";
  if (/säästö|saasto|savings/i.test(text)) return "savings";
  return "other";
}

export function accountName(a: EbAccount): string {
  return a.name?.trim() || a.product?.trim() || a.details?.trim() || a.account_id?.iban || "Tili";
}

/** Prefers booked/closing balance types, falls back to whatever the bank gives. */
export function pickBalance(balances: EbBalance[]): EbBalance | null {
  const order = ["CLBD", "ITBD", "XPCD", "CLAV", "ITAV", "OPBD"];
  return [...balances].sort((a, b) => rank(a.balance_type) - rank(b.balance_type))[0] ?? null;
  function rank(t: string) {
    const i = order.indexOf(t);
    return i === -1 ? order.length : i;
  }
}
