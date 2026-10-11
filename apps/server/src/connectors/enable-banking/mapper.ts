import type { AccountType, RawTransaction } from "@banking/core";
import type { AccountDetails } from "../types.ts";
import type { EbAccount, EbBalance, EbTransaction } from "./types.ts";

/**
 * "12.50", "-12.5", "12,50" → cents, read from the digits so no float error creeps in. Null when the text is
 * not a plain decimal number: a made-up amount is worse than a missing row.
 */
export function amountToCents(amount: string): number | null {
  const m = /^\s*([+-])?(\d{1,13})(?:[.,](\d+))?\s*$/.exec(String(amount));
  if (!m) return null;
  const fraction = (m[3] ?? "").padEnd(3, "0");
  const cents = Number(m[2]) * 100 + Number(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1 : 0);
  return m[1] === "-" ? -cents : cents;
}

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

function realDate(y: number, mo: number, d: number): boolean {
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * A bank's date as YYYY-MM-DD in the household's time zone. A plain date is the bank's own calendar day and
 * stays as it is. A time with an offset or Z is moved to the zone (22:30 UTC is the next day in Helsinki); a
 * time without an offset is already local. Anything else is not a date.
 */
export function bankDate(value: string | null | undefined, timeZone = "Europe/Helsinki"): string | null {
  const s = value?.trim();
  if (!s) return null;
  const plain = PLAIN_DATE.exec(s);
  if (plain) return realDate(Number(plain[1]), Number(plain[2]), Number(plain[3])) ? s : null;
  const dt = DATE_TIME.exec(s);
  if (!dt) return null;
  const day = PLAIN_DATE.exec(dt[1]!)!;
  if (!realDate(Number(day[1]), Number(day[2]), Number(day[3]))) return null;
  if (!dt[3]) return dt[1]!;
  const offset = /^[+-]\d{2}$/.test(dt[3]) ? `${dt[3]}:00` : dt[3]!.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const at = new Date(`${dt[1]}T${dt[2]!.length === 5 ? `${dt[2]}:00` : dt[2]}${offset.toUpperCase()}`);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return dt[1]!;
  }
}

export function mapTransaction(t: EbTransaction, timeZone?: string): RawTransaction | null {
  const status = t.status === "BOOK" ? "booked" : t.status === "PDNG" ? "pending" : null;
  // the first of the bank's dates that is a date, so one garbled field does not hide the row
  const bookingDate = [t.booking_date, t.transaction_date, t.value_date].map((d) => bankDate(d, timeZone)).find((d) => d !== null) ?? null;
  const signed = amountToCents(t.transaction_amount?.amount);
  if (!status || !bookingDate || signed === null) return null;
  // the bank's own direction decides; a sign on the amount counts only when the direction is missing
  const out = t.credit_debit_indicator === "DBIT" ? true : t.credit_debit_indicator === "CRDT" ? false : signed < 0;
  const cents = Math.abs(signed);
  const party = out ? t.creditor : t.debtor;
  const partyAccount = out ? t.creditor_account : t.debtor_account;
  const description = [...(t.remittance_information ?? []), t.note]
    .filter((x): x is string => !!x?.trim())
    .join(" ")
    .trim();
  return {
    externalId: t.entry_reference || t.transaction_id || null,
    bookingDate,
    valueDate: bankDate(t.value_date, timeZone),
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

/** What a bank calls a savings account: Säästötili, Pikasäästö, ASP-tili, Tuottotili, Sijoitustili. */
const SAVINGS_PRODUCT = /säästö|saasto|savings|\basp\b|tuotto|sijoitus/i;

export function accountType(a: EbAccount): AccountType {
  // the bank's own type code wins: a current account's product text can mention a card
  // ("tili ja kortti"), and calling it a card account would turn its income into transfers
  if (a.cash_account_type === "LOAN") return "loan";
  // cards are identified by a masked card number (scheme CPAN) instead of an IBAN
  if (a.cash_account_type === "CARD" || a.account_id?.other?.scheme_name === "CPAN") return "credit_card";
  if (a.cash_account_type === "SVGS") return "savings";
  if (a.cash_account_type === "CACC" || a.cash_account_type === "TRAN") {
    // Nordea sends CACC for every account, so a savings product says what the code does not (never the holder's name)
    return SAVINGS_PRODUCT.test(`${a.product ?? ""} ${a.details ?? ""}`) ? "savings" : "checking";
  }
  const text = `${a.name ?? ""} ${a.product ?? ""} ${a.details ?? ""}`;
  // "Asuntolainatili": before the card words, a loan account name may also contain "luotto"
  if (/laina|loan|mortgage|asuntoluotto/i.test(text)) return "loan";
  if (/luotto|credit|kortti|card/i.test(text)) return "credit_card";
  if (/säästö|saasto|savings/i.test(text)) return "savings";
  return "other";
}

/**
 * Who holds the account. The bank's `name` is the holder ("A;B" for two), not a name for the account, so it is kept
 * as a line of its own ("A, B").
 */
export function accountHolder(a: EbAccount): string | null {
  const names = (a.name ?? "")
    .split(";")
    .map((n) => n.trim())
    .filter(Boolean);
  return names.length ? names.join(", ").slice(0, 120) : null;
}

/** The bank's product name when it gives one, else what it gave before product names were read: the holder, then the description. */
function nameOf(a: EbAccount): string | null {
  return (a.product?.trim() || accountHolder(a) || a.details?.trim() || a.account_id?.iban || null)?.slice(0, 120) ?? null;
}

export function accountName(a: EbAccount): string {
  return nameOf(a) ?? "Tili";
}

/** A card's last four digits. Whatever else the bank sends of the number is not stored. */
export function cardMask(a: EbAccount): string | null {
  const ids = [a.account_id?.other, ...(a.all_account_ids ?? [])];
  const card = ids.find((id) => id?.scheme_name === "CPAN" && id.identification);
  const last4 = card?.identification?.replace(/\D/g, "").slice(-4) ?? "";
  return last4.length === 4 ? `•••• ${last4}` : null;
}

/** The credit limit in cents, when the bank gives a positive one in euros. */
export function creditLimitCents(a: EbAccount): number | null {
  const limit = a.credit_limit;
  if (!limit || (limit.currency && limit.currency !== "EUR")) return null;
  const cents = amountToCents(limit.amount);
  return cents !== null && cents > 0 ? cents : null;
}

/** What an account resource says about the account itself: the name, the holder, a card's number and a limit. */
export function accountDetails(a: EbAccount): AccountDetails {
  return { name: nameOf(a), holder: accountHolder(a), cardMask: cardMask(a), creditLimitCents: creditLimitCents(a) };
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
