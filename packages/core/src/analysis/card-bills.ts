/**
 * Card bills that count as spending, by month: the rows the `card_bills` signal of the data quality report adds up. A
 * card connected later, or a card that is not connected, leaves its bill as one payment from the account, with the
 * purchases behind it in no category. The months view and the food report name this sum so a list of categories is
 * not read as the whole.
 */
import { dateIn, fromMonthIndex, monthEnd } from "../dates.ts";
import { cardIssuerName, cardIssuerOfAccountText, fold } from "../merchant.ts";
import type { Account, IsoDate } from "../types.ts";
import { type AnalysisContext, type AnalysisTx, inDays, loweredRows } from "./context.ts";
import { type DateRange, toDayRange } from "./period.ts";

/** A row of a card bill that counts as spending: the rows the card_bills signal adds up. */
export const isCardBill = (t: Pick<AnalysisTx, "category" | "spend">): boolean => t.category === "card_bill" && t.spend > 0;

/** Whose card a bill is for: the issuer's one name, or the merchant's own name where it is no issuer of the list. */
const billIssuer = (t: Pick<AnalysisTx, "merchant">): string => cardIssuerName(fold(t.merchant)) ?? t.merchant;

export interface MissingCardPurchases {
  issuer: string;
  /** The bills' sum, the same cents the card_bills signal adds up. */
  cents: number;
  count: number;
  lastDate: IsoDate;
  /** No connected card of the issuer for these bills, or a connected card whose rows begin after them (`since`). */
  reason: "not_connected" | "before_history";
  /** The day the connected card's rows begin; null for not_connected. */
  since: IsoDate | null;
}

/** Words that name no issuer: what a card account or a bank is called in general, and the legal forms. */
const GENERIC = new Set(["BANK", "PANKKI", "CARD", "KORTTI", "KORT", "CREDIT", "LUOTTOKORTTI", "VISA", "MASTERCARD", "GOLD", "PLATINUM", "OY", "OYJ", "AB", "ASA", "AS", "SUOMI", "FINLAND", "GROUP", "FILIAL"]);
const distinctWords = (text: string): string[] => fold(text).split(/[^A-Z0-9]+/).filter((w) => w.length > 1 && !GENERIC.has(w));

/** What a card account says of its issuer: the list's name (`cardIssuerOfAccountText`) and the words of its bank and names. */
function issuerOfAccount(a: Account): { listed: string | null; words: Set<string> } {
  const texts = [a.bank, a.bankName, a.name].filter((x): x is string => !!x?.trim());
  return { listed: cardIssuerOfAccountText(fold(texts.join(" "))), words: new Set(texts.flatMap(distinctWords)) };
}

/**
 * The card bills of a range that count as spending, by issuer: what they sum to, how many, the last, and why the
 * purchases behind them are in no category. A bill dated before the day a connected card's rows begin is the bank's
 * history (`before_history`); a bill on or after that day, or of an issuer none of whose cards is connected, is of a
 * card that is not connected. An issuer with both has a row for each. Largest sum first. A card matches an issuer by the
 * list's name, or for an issuer outside the list by a whole word of its name that the card's bank or names also hold.
 */
export function missingCardPurchases(ctx: AnalysisContext, range: DateRange): MissingCardPurchases[] {
  const began = new Map<string, IsoDate>();
  for (const t of ctx.txs) if (t.bookingDate < (began.get(t.accountId) ?? "9999-99-99")) began.set(t.accountId, t.bookingDate);
  const cards = ctx.accounts.filter((a) => a.type === "credit_card" && began.has(a.id)).map((a) => ({ ...issuerOfAccount(a), since: began.get(a.id)! }));
  const sinceOf = new Map<string, IsoDate | null>();
  const bills = new Map<string, MissingCardPurchases>();
  for (const t of loweredRows(ctx, inDays(ctx, toDayRange(range)))) {
    if (!isCardBill(t)) continue;
    const issuer = billIssuer(t);
    if (!sinceOf.has(issuer)) {
      const listed = cardIssuerName(fold(issuer)) !== null;
      const words = distinctWords(issuer);
      const own = cards.filter((c) => (listed ? c.listed === issuer : words.some((w) => c.words.has(w))));
      sinceOf.set(issuer, own.length ? own.map((c) => c.since).sort()[0]! : null);
    }
    const since = sinceOf.get(issuer)!;
    const early = since !== null && t.bookingDate < since;
    const key = `${issuer}\u0000${early}`;
    const had = bills.get(key);
    if (had) {
      had.cents += t.spend;
      had.count++;
      if (t.bookingDate > had.lastDate) had.lastDate = t.bookingDate;
    } else bills.set(key, { issuer, cents: t.spend, count: 1, lastDate: t.bookingDate, reason: early ? "before_history" : "not_connected", since: early ? since : null });
  }
  return [...bills.values()].sort((a, b) => b.cents - a.cents || a.issuer.localeCompare(b.issuer, "fi") || a.reason.localeCompare(b.reason));
}

/** The cents of card bills in each of `months` (month indexes), in the order of `months`; 0 for a month without one. */
export function cardBillsByMonth(ctx: AnalysisContext, months: readonly number[]): number[] {
  if (!months.length) return [];
  const range = toDayRange({ from: dateIn(fromMonthIndex(Math.min(...months)), 1), to: monthEnd(fromMonthIndex(Math.max(...months))) });
  const by = new Map<number, number>(months.map((m) => [m, 0]));
  for (const t of loweredRows(ctx, inDays(ctx, range))) if (isCardBill(t) && by.has(t.month)) by.set(t.month, by.get(t.month)! + t.spend);
  return months.map((m) => by.get(m)!);
}
