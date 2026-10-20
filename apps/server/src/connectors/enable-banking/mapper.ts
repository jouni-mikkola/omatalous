import type { AccountType, RawTransaction } from "@banking/core";
import type { AccountDetails, BalanceReading, BankAccountFields, RefusalReason } from "../types.ts";
import type { EbAccount, EbBalance, EbPartyAccount, EbTransaction } from "./types.ts";

/**
 * "12.50", "-12.5", "12,50" → cents, read from the digits so no float error creeps in. Null when the text is
 * not a plain decimal number: a made-up amount is worse than a missing row.
 */
function amountToCents(amount: string): number | null {
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

/**
 * The bank's own transaction code as ISO 20022 names it, the parts joined in order: "PMNT-CCRD-POSD", or "CCRD-POSD"
 * from a bank that leaves the domain out. Banks split the parts over `code` and `sub_code` in their own ways, so both
 * are read. A code is two or three parts of four characters each: free text in these fields, a bank's own numbering
 * or a family without its sub-family is no code, and gives null.
 */
export function bankTxnCode(c: EbTransaction["bank_transaction_code"]): string | null {
  const parts = [c?.code, c?.sub_code].flatMap((x) => (typeof x === "string" ? x.toUpperCase().split(/[^\p{L}\p{N}]+/u) : [])).filter(Boolean);
  return (parts.length === 2 || parts.length === 3) && parts.every((p) => /^[A-Z0-9]{4}$/.test(p)) ? parts.join("-") : null;
}

/** Whether an IBAN's check digits hold (ISO 13616, mod 97). */
function validIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return BigInt(digits) % 97n === 1n;
}

/**
 * A Finnish account number as its IBAN: "123456-785" (zeros go after the seventh digit for the banks whose numbers
 * start with 4 or 5, else after the sixth) or the 14 digits, held to its Luhn check digit. Null for anything else.
 */
function finnishIban(bban: string): string | null {
  const m = /^(\d{6})-(\d{2,8})$/.exec(bban);
  const digits = m ? (/^[45]/.test(m[1]!) ? m[1]! + m[2]![0] + m[2]!.slice(1).padStart(7, "0") : m[1]! + m[2]!.padStart(8, "0")) : /^\d{14}$/.test(bban) ? bban : null;
  if (!digits) return null;
  const sum = [...digits].reverse().reduce((acc, d, i) => {
    const n = Number(d) * (i % 2 ? 2 : 1);
    return acc + (n > 9 ? n - 9 : n);
  }, 0);
  if (sum % 10) return null;
  const check = 98 - Number(BigInt(`${digits}151800`) % 97n);
  return `FI${String(check).padStart(2, "0")}${digits}`;
}

/**
 * The IBAN of the other party's account: its `iban`, else an IBAN or a Finnish account number the bank gave as another
 * identification. A bank that names the payee that way would otherwise leave the payment to an own account unknown.
 */
function partyIban(account: EbPartyAccount | null | undefined): string | null {
  if (account?.iban) return account.iban;
  const id = account?.other?.identification?.trim().toUpperCase();
  if (!id) return null;
  const compact = id.replace(/\s+/g, "");
  if (validIban(compact)) return compact;
  const scheme = account?.other?.scheme_name?.trim().toUpperCase();
  return !scheme || scheme === "BBAN" ? finnishIban(compact) : null;
}

/** The fields a row cannot be read without: its status, its first readable date and its amount, each null when missing. */
function essentials(t: EbTransaction, timeZone?: string) {
  const status = t.status === "BOOK" ? ("booked" as const) : t.status === "PDNG" ? ("pending" as const) : null;
  // the first of the bank's dates that is a date, so one garbled field does not hide the row
  const bookingDate = [t.booking_date, t.transaction_date, t.value_date].map((d) => bankDate(d, timeZone)).find((d) => d !== null) ?? null;
  return { status, bookingDate, signed: amountToCents(t.transaction_amount?.amount) };
}

/** Why `mapTransaction` refuses a row (the first reason that holds), or null for a row it reads. */
export function refusalOf(t: EbTransaction, timeZone?: string): RefusalReason | null {
  const { status, bookingDate, signed } = essentials(t, timeZone);
  return !status ? "status" : signed === null ? "amount" : !bookingDate ? "date" : null;
}

export function mapTransaction(t: EbTransaction, timeZone?: string): RawTransaction | null {
  const { status, bookingDate, signed } = essentials(t, timeZone);
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
    counterpartyIban: partyIban(partyAccount),
    description: description || t.bank_transaction_code?.description || null,
    reference: t.reference_number ?? null,
    mcc: t.merchant_category_code ?? null,
    bankTxnCode: bankTxnCode(t.bank_transaction_code),
    raw: t,
  };
}

/** What a bank calls a savings account: Säästötili, Pikasäästö, ASP-tili, Tuottotili, Sijoitustili. */
const SAVINGS_PRODUCT = /säästö|saasto|savings|\basp\b|tuotto|sijoitus/i;

export function accountType(a: EbAccount): AccountType {
  const code = bankCode(a.cash_account_type);
  // the bank's own type code wins: a current account's product text can mention a card
  // ("tili ja kortti"), and calling it a card account would turn its income into transfers
  if (code === "LOAN") return "loan";
  // cards are identified by a masked card number (scheme CPAN) instead of an IBAN
  if (code === "CARD" || a.account_id?.other?.scheme_name === "CPAN") return "credit_card";
  if (code === "SVGS") return "savings";
  // the product and the description only, never `name`: that is the holder, and "Sloane" holds "loan", "Ricardo" "card"
  const text = `${a.product ?? ""} ${a.details ?? ""}`;
  if (code === "CACC" || code === "TRAN") {
    // Nordea sends CACC for every account, so a savings product says what the code does not
    return SAVINGS_PRODUCT.test(text) ? "savings" : "checking";
  }
  // "Asuntolainatili": before the card words, a loan account name may also contain "luotto"
  if (/laina|loan|mortgage|asuntoluotto/i.test(text)) return "loan";
  if (/luotto|credit|kortti|card/i.test(text)) return "credit_card";
  if (SAVINGS_PRODUCT.test(text)) return "savings";
  // with no code and no word for it, an account with an IBAN is one money goes in and out of: a loan or a card needs evidence
  return a.account_id?.iban ? "checking" : "other";
}

/**
 * The type 0.64.0 worked out, kept for the upgrade only: an account stored before migration 0023 whose type differs from
 * what this gives for the same answer had its type set by hand in Asetukset > Tilit, and no link or fetch may undo that.
 */
export function earlierType(a: EbAccount): AccountType {
  if (a.cash_account_type === "LOAN") return "loan";
  if (a.cash_account_type === "CARD" || a.account_id?.other?.scheme_name === "CPAN") return "credit_card";
  if (a.cash_account_type === "SVGS") return "savings";
  if (a.cash_account_type === "CACC" || a.cash_account_type === "TRAN") return SAVINGS_PRODUCT.test(`${a.product ?? ""} ${a.details ?? ""}`) ? "savings" : "checking";
  const text = `${a.name ?? ""} ${a.product ?? ""} ${a.details ?? ""}`;
  if (/laina|loan|mortgage|asuntoluotto/i.test(text)) return "loan";
  if (/luotto|credit|kortti|card/i.test(text)) return "credit_card";
  if (/säästö|saasto|savings/i.test(text)) return "savings";
  return "other";
}

/** A code as the bank sent it, upper case, or "" when it sent none or something that is no code. */
function bankCode(v: string | null | undefined): string {
  const code = (v ?? "").trim().toUpperCase();
  return /^[A-Z]{1,8}$/.test(code) ? code : "";
}

/** A free text of the bank's, trimmed and cut, or null. */
function bankText(v: string | null | undefined, max: number): string | null {
  return v?.trim().slice(0, max) || null;
}

/** What the bank says the account is, kept as sent so a wrong guess of the type can be seen (migration 0023). */
export function bankAccountFields(a: EbAccount): BankAccountFields {
  return { bankTypeCode: bankCode(a.cash_account_type), bankUsage: bankText(a.usage, 8)?.toUpperCase() ?? null, bankProduct: bankText(a.product, 120), psuStatus: bankText(a.psu_status, 40) };
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

/**
 * What an account resource says about the account itself: the name, the holder, a card's number, a limit and its type.
 * The type is null when the answer says nothing of what kind the account is (no code, product, description, IBAN or
 * card number): a guess from nothing must not replace the type the link worked out.
 */
export function accountDetails(a: EbAccount): AccountDetails {
  const fields = bankAccountFields(a);
  const evidence = fields.bankTypeCode || fields.bankProduct || a.details?.trim() || a.account_id?.iban || cardMask(a);
  return { name: nameOf(a), holder: accountHolder(a), cardMask: cardMask(a), creditLimitCents: creditLimitCents(a), type: evidence ? accountType(a) : null, earlierType: earlierType(a), ...fields };
}

/**
 * A balance with what says what it is: its code as sent, the day the bank says it stands for (null when it sends none or
 * something that is no date) and its currency in upper case. Null when the amount is no number.
 */
export function balanceReading(b: EbBalance): BalanceReading | null {
  const cents = amountToCents(b.balance_amount.amount);
  if (cents === null) return null;
  return {
    cents,
    type: b.balance_type?.trim() || null,
    referenceDay: bankDate(b.reference_date),
    currency: b.balance_amount.currency?.trim().toUpperCase() || null,
  };
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
