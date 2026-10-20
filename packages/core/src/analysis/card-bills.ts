/**
 * Card bills that count as spending, by month: the rows the `card_bills` signal of the data quality report adds up. A
 * card connected later, or a card that is not connected, leaves its bill as one payment from the account, with the
 * purchases behind it in no category. The months view and the food report name this sum so a list of categories is
 * not read as the whole.
 */
import { dateIn, fromMonthIndex, monthEnd } from "../dates.ts";
import { cardIssuerName, cardIssuerOfAccountText, cardName, fold } from "../merchant.ts";
import type { Account, BalanceInput, IsoDate } from "../types.ts";
import { type AnalysisContext, type AnalysisTx, inDays, loweredRows } from "./context.ts";
import { type DateRange, toDayRange } from "./period.ts";

/** A row of a card bill that counts as spending: the rows the card_bills signal adds up. */
export const isCardBill = (t: Pick<AnalysisTx, "category" | "spend">): boolean => t.category === "card_bill" && t.spend > 0;

/** Whose card a bill is for: the issuer's one name, or the merchant's own name where it is no issuer of the list. */
const billIssuer = (t: Pick<AnalysisTx, "merchant">): string => cardIssuerName(fold(t.merchant)) ?? t.merchant;

export interface MissingCardPurchases {
  issuer: string;
  /** What the row is called: the issuer, and where two rows would read the same, the card the row is of (`labelled`). */
  label: string;
  /** The bills' sum, the same cents the card_bills signal adds up. */
  cents: number;
  count: number;
  lastDate: IsoDate;
  /**
   * Why the purchases are not in the data: no card of the issuer is connected (`not_connected`), a connected card's rows
   * begin after these bills (`before_history`: nothing can be asked, the bank gives no older rows), or the bills are of
   * the time a connected card has rows and still pair with none of them (`unmatched`).
   */
  reason: "not_connected" | "before_history" | "unmatched";
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
 * history (`before_history`); a bill on or after that day pairs with none of the card's rows (`unmatched`); a bill of an
 * issuer none of whose cards is connected is `not_connected`. An issuer with more than one kind has a row for each. Largest sum first. A card matches an issuer by the
 * list's name, or for an issuer outside the list by a whole word of its name that the card's bank or names also hold.
 * `balances` give the cards' numbers for the label of a row.
 */
export function missingCardPurchases(ctx: AnalysisContext, range: DateRange, balances: readonly Pick<BalanceInput, "id" | "cardMask">[] = []): MissingCardPurchases[] {
  const began = new Map<string, IsoDate>();
  for (const t of ctx.txs) if (t.bookingDate < (began.get(t.accountId) ?? "9999-99-99")) began.set(t.accountId, t.bookingDate);
  const cards = ctx.accounts.filter((a) => a.type === "credit_card" && began.has(a.id)).map((a) => ({ ...issuerOfAccount(a), since: began.get(a.id)!, account: a }));
  const sinceOf = new Map<string, { since: IsoDate; card: Account } | null>();
  const bills = new Map<string, MissingCardPurchases>();
  for (const t of loweredRows(ctx, inDays(ctx, toDayRange(range)))) {
    if (!isCardBill(t)) continue;
    const issuer = billIssuer(t);
    if (!sinceOf.has(issuer)) {
      const listed = cardIssuerName(fold(issuer)) !== null;
      const words = distinctWords(issuer);
      const own = cards.filter((c) => (listed ? c.listed === issuer : words.some((w) => c.words.has(w))));
      const first = own.sort((a, b) => a.since.localeCompare(b.since))[0];
      sinceOf.set(issuer, first ? { since: first.since, card: first.account } : null);
    }
    const since = sinceOf.get(issuer)?.since ?? null;
    const reason = since === null ? "not_connected" : t.bookingDate < since ? "before_history" : "unmatched";
    const key = `${issuer}\u0000${reason}`;
    const had = bills.get(key);
    if (had) {
      had.cents += t.spend;
      had.count++;
      if (t.bookingDate > had.lastDate) had.lastDate = t.bookingDate;
    } else bills.set(key, { issuer, label: issuer, cents: t.spend, count: 1, lastDate: t.bookingDate, reason, since });
  }
  const rows = [...bills.values()].sort((a, b) => b.cents - a.cents || a.issuer.localeCompare(b.issuer, "fi") || a.reason.localeCompare(b.reason));
  // an issuer with two rows has one for the bank's history, which a connected card owns: that row names the card
  for (const row of rows) {
    const card = row.reason === "before_history" && rows.filter((r) => r.issuer === row.issuer).length > 1 ? sinceOf.get(row.issuer)?.card : undefined;
    if (card) row.label = labelled(row.issuer, card, balances.find((b) => b.id === card.id)?.cardMask);
  }
  return rows;
}

/** The last four digits a bank's card number ends in ("•••• 1234", "5225********1144"), or null where it gives fewer. */
const lastFour = (mask: string | null | undefined): string | null => {
  const digits = (mask ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
};

/** A card's row among rows of its issuer: the issuer and the last four digits as the account list prints them, else the card's product name. */
function labelled(issuer: string, card: Account, mask: string | null | undefined): string {
  const four = lastFour(mask);
  if (four) return `${issuer} ·· ${four}`;
  const name = cardName(card.name);
  const product = name.toLowerCase().startsWith(issuer.toLowerCase()) ? name.slice(issuer.length).trim() : name;
  return product ? `${issuer} ${product}` : issuer;
}

/** The cents of card bills in each of `months` (month indexes), in the order of `months`; 0 for a month without one. */
export function cardBillsByMonth(ctx: AnalysisContext, months: readonly number[]): number[] {
  if (!months.length) return [];
  const range = toDayRange({ from: dateIn(fromMonthIndex(Math.min(...months)), 1), to: monthEnd(fromMonthIndex(Math.max(...months))) });
  const by = new Map<number, number>(months.map((m) => [m, 0]));
  for (const t of loweredRows(ctx, inDays(ctx, range))) if (isCardBill(t) && by.has(t.month)) by.set(t.month, by.get(t.month)! + t.spend);
  return months.map((m) => by.get(m)!);
}
