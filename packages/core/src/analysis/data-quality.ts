import { missingCardPurchases, type MissingCardPurchases } from "./card-bills.ts";
import { type AnalysisContext, type AnalysisTx, inDays, netSpend, spendRows } from "./context.ts";
import { type FiledWithoutAsking, filedWithoutAsking } from "./filed.ts";
import { finnishList, formatEur, formatFiDate } from "./format.ts";
import { type DateRange, toDayRange } from "./period.ts";
import { addMonths, dateIn, daysBetween, monthEnd, monthOf } from "../dates.ts";
import type { BalanceInput, IsoDate } from "../types.ts";

export type QualityTone = "warning" | "info";

export interface QualitySignal {
  id: "short_history" | "uncategorised" | "gap" | "stale" | "card_bills" | "own_unconnected" | "no_balance";
  tone: QualityTone;
  title: string;
  detail: string;
  /** The sum the signal is about, for a signal that names one. */
  cents?: number;
  /** A link target the page can offer: a category id for the transaction list. */
  category?: string;
  /** The card bills of the `card_bills` signal by issuer: the table under its title. */
  cardPurchases?: MissingCardPurchases[];
}

export interface DataQualityReport {
  signals: QualitySignal[];
  /** How much of the last 12 months' spending the app filed without asking; null when there was none. */
  filed: FiledWithoutAsking | null;
}

const SHORT_HISTORY_DAYS = 90;
// 5 % of a family's spending is often the third largest category
const UNCATEGORISED_SHARE = 0.05;
/**
 * What a share of spending is measured against: the spending of each category with its refunds taken off, the
 * categories that net above zero added up. A category with more refunds than spending takes nothing off the base, so
 * no share passes 100 %. The Kategoriat shares, the share of "Muut menot" here and the dashboard's category list use
 * this one base; the net total of the cashflow report is a different figure and can be smaller.
 */
export function spendingBase(txs: readonly Pick<AnalysisTx, "spend" | "category">[]): number {
  const net = new Map<string, number>();
  for (const t of txs) net.set(t.category, (net.get(t.category) ?? 0) + t.spend);
  let base = 0;
  for (const cents of net.values()) if (cents > 0) base += cents;
  return base;
}

/** A row of Muut menot that nobody set: the user's own choice of that category is an answer, not a gap. */
const isUnknownOther = (t: Pick<AnalysisTx, "category" | "categorySource">): boolean => t.category === "other" && t.categorySource !== "user";

/** The spending rows of a range, the Muut menot nobody set among them and the card bills whose purchases are not itemised. */
function spendingParts(ctx: AnalysisContext, range: DateRange): { rows: AnalysisTx[]; otherCents: number; bills: MissingCardPurchases[]; billCents: number; spendingCents: number } {
  const rows = spendRows(ctx, toDayRange(range));
  const otherCents = rows.reduce((s, t) => (isUnknownOther(t) && t.spend > 0 ? s + netSpend(t) : s), 0);
  // the card bills are the table of the card_bills signal: one sum on every page
  const bills = missingCardPurchases(ctx, range);
  return { rows, otherCents, bills, billCents: bills.reduce((s, m) => s + m.cents, 0), spendingCents: spendingBase(rows) };
}

/** The twelve complete months up to `to`: the month of `to` when `to` is its last day, else the twelve before it. */
function completeYear(to: IsoDate): DateRange {
  const month = monthEnd(monthOf(to)) === to ? monthOf(to) : addMonths(monthOf(to), -1);
  return { from: dateIn(addMonths(month, -11), 1), to: monthEnd(month) };
}

/** The whole percent of a known share, rounded down: 99,6 % is "99 %", never "100 %". */
const knownPercent = (share: number): number => Math.floor(share * 100 + 1e-9);

interface KnownSpending {
  /** The part of the window's spending that the app knows what it was, 0 to 1; null when nothing was spent. */
  share: number | null;
  /** The twelve complete months the share is of (`completeYear`). */
  window: DateRange;
  /** Muut menot that nobody set: the part not known. */
  otherCents: number;
  /** What the share is of: the spending base without the card bills, whose purchases are a gap of the data and not a question. */
  spendingCents: number;
  /** The card bills of the window whose purchases are not itemised, by issuer and kind (`missingCardPurchases`). */
  bills: MissingCardPurchases[];
}

/**
 * "Tunnistettu X % menoista": the one measure of how much of the spending is known, over the twelve complete months up
 * to `to` (no later than today). Known is every spending row but Muut menot that nobody set; a card bill whose purchases
 * are not itemised is left out of both sides, because the household cannot answer it: its kinds (`bills`) are said in
 * sentences of their own. The questions, Tietojen laatu, Raportit and Optimoi read this one function.
 */
export function knownSpending(ctx: AnalysisContext, to: IsoDate = ctx.today): KnownSpending {
  const window = completeYear(to < ctx.today ? to : ctx.today);
  const { rows, otherCents, bills } = spendingParts(ctx, window);
  const spendingCents = spendingBase(rows.filter((t) => t.category !== "card_bill"));
  const share = spendingCents > 0 ? Math.min(1, Math.max(0, 1 - otherCents / spendingCents)) : null;
  return { share, window, otherCents, spendingCents, bills };
}

/**
 * The spending of the range that nothing says what it was: card bills whose purchases are not itemised and Muut menot
 * that nobody set, against the spending base of the statement-lowered rows (`spendRows`: a bill counts at what its
 * statement rows leave of it). `otherShare` is Muut menot alone over the range. `share` is the part not known of the
 * one measure (`knownSpending`) for the twelve complete months up to the range's end, so every page that says how much
 * is not known (Raportit, Optimoi) says the same figure. A purchase counts at what it cost in the end; a Muut menot row
 * the user chose is known.
 */
export function unknownSpending(ctx: AnalysisContext, range: DateRange): { otherCents: number; billCents: number; spendingCents: number; otherShare: number; share: number } {
  const { otherCents, billCents, spendingCents } = spendingParts(ctx, range);
  const known = knownSpending(ctx, range.to);
  return { otherCents, billCents, spendingCents, otherShare: spendingCents > 0 ? Math.min(1, otherCents / spendingCents) : 0, share: known.spendingCents > 0 ? Math.min(1, known.otherCents / known.spendingCents) : 0 };
}

/** The measure in the page's words, its window named. */
const knownTitle = (share: number): string => `${knownPercent(share)} % viimeisen 12 valmiin kuukauden menoista on tunnistettu`;

const GAP_DAYS = 14;
const STALE_DAYS = 7;
/** A card is used less often than a checking account: three weeks of quiet is ordinary. */
const CARD_STALE_DAYS = 21;
/** Only these accounts are checked for gaps: a savings account can be silent for months. */
const ACTIVE_TYPES = new Set(["checking", "credit_card"]);

/**
 * Where the numbers on the reports may be shaky: a short history, rows no rule
 * recognised, a hole in the fetched dates, card bills counted as spending,
 * savings sent where no account is connected, accounts without a balance.
 * Each signal says what is wrong and what it does to the figures. `balances`
 * are the accounts in view, as the balance report reads them.
 */
export function dataQualityReport(ctx: AnalysisContext, range: DateRange, balances: readonly BalanceInput[] = []): DataQualityReport {
  const signals: QualitySignal[] = [];
  const days = toDayRange(range);
  const inRange = inDays(ctx, days);

  if (ctx.dataFrom) {
    const span = daysBetween(ctx.dataFrom, ctx.today);
    if (span < SHORT_HISTORY_DAYS) {
      signals.push({
        id: "short_history",
        tone: "info",
        title: "Historiaa on vasta vähän",
        detail: `Tapahtumat alkavat ${formatFiDate(ctx.dataFrom)}. Vertailut tarkentuvat, kun historiaa on kolme kuukautta.`,
      });
    }
  }

  const { billCents: billTotal } = unknownSpending(ctx, range);
  const known = knownSpending(ctx, range.to);
  if (known.share !== null && 1 - known.share >= UNCATEGORISED_SHARE) {
    const byMerchant = new Map<string, number>();
    for (const t of spendRows(ctx, toDayRange(known.window))) if (isUnknownOther(t) && t.spend > 0) byMerchant.set(t.merchant, (byMerchant.get(t.merchant) ?? 0) + netSpend(t));
    const top = [...byMerchant.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m);
    signals.push({
      id: "uncategorised",
      tone: "warning",
      title: knownTitle(known.share),
      detail: `${formatEur(known.otherCents, false)} on kategoriassa Muut menot${top.length ? `, suurimpina ${top.join(", ")}` : ""}. Luokittele kauppiaat, niin vertailut tarkentuvat.`,
      category: "other",
      cents: known.otherCents,
    });
  }

  // a hole inside the history, or an account that has gone quiet: the fetch or the export missed days
  for (const account of ctx.accounts) {
    if (!ACTIVE_TYPES.has(account.type)) continue;
    const dates = [...new Set(ctx.txs.filter((t) => t.accountId === account.id).map((t) => t.bookingDate))].sort();
    if (dates.length < 10) continue;
    let widest: { from: string; to: string; days: number } | null = null;
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1]!, dates[i]!);
      if (gap >= GAP_DAYS && dates[i]! >= range.from && dates[i - 1]! <= range.to && (!widest || gap > widest.days)) widest = { from: dates[i - 1]!, to: dates[i]!, days: gap };
    }
    if (widest) {
      signals.push({
        id: "gap",
        tone: "warning",
        title: `Tilin ${account.name} tiedoissa on ${widest.days} päivän tauko`,
        detail: `${formatFiDate(widest.from)}–${formatFiDate(widest.to)} ei ole tapahtumia. Hae tapahtumat uudelleen, jos tilillä oli liikettä.`,
      });
    }
    const last = dates[dates.length - 1]!;
    if (daysBetween(last, ctx.today) > (account.type === "credit_card" ? CARD_STALE_DAYS : STALE_DAYS) && range.to >= last) {
      signals.push({
        id: "stale",
        tone: "info",
        title: `Tilin ${account.name} viimeinen tapahtuma on ${formatFiDate(last)}`,
        detail: "Uudempia tapahtumia ei ole haettu. Jakson lopun luvut voivat olla vajaita.",
      });
    }
  }

  // the bills are of the months before a connected card's rows, or of a card that is not connected
  const missing = missingCardPurchases(ctx, range, balances);
  if (billTotal > 0) {
    signals.push({
      id: "card_bills",
      tone: "warning",
      title: `Korttilaskuja ${formatEur(billTotal, false)}, mutta kortin ostot puuttuvat`,
      detail: missing.some((m) => m.reason === "not_connected") ? "Yhdistä kortti." : "",
      category: "card_bill",
      cents: billTotal,
      cardPurchases: missing,
    });
  }

  // money sent to an own account or fund that is not connected is counted as saved: the savings rate takes it on trust
  const sentAway = inRange.filter((t) => !t.isTransfer && t.flows.saved !== 0);
  const saved = sentAway.reduce((s, t) => s + t.flows.saved, 0);
  if (saved > 0) {
    const byPayee = new Map<string, number>();
    const byCategory = new Map<string, number>();
    for (const t of sentAway) {
      byPayee.set(t.merchant, (byPayee.get(t.merchant) ?? 0) + t.flows.saved);
      byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.flows.saved);
    }
    const largest = [...byPayee.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m);
    signals.push({
      id: "own_unconnected",
      tone: "info",
      title: `Säästöön meni ${formatEur(saved, false)} tilille, jota ei ole yhdistetty`,
      detail: `${largest.length ? `Suurimmat saajat: ${finnishList(largest)}. ` : ""}Yhdistä tili.`,
      category: [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]![0],
      cents: saved,
    });
  }

  // the buffer and the next 30 days start from a balance; only the viewer's own accounts can be fixed by the viewer
  const unknown = balances.filter((a) => a.ownerName === null && a.balanceCents === null && (a.type === "checking" || a.type === "savings"));
  if (unknown.length) {
    signals.push({
      id: "no_balance",
      tone: "info",
      title: unknown.length === 1 ? `Tilin ${unknown[0]!.name} saldoa ei tiedetä` : `${unknown.length} tilin saldoa ei tiedetä: ${finnishList(unknown.map((a) => a.name))}`,
      detail: "Lisää saldo kohdassa Asetukset > Tilit, niin puskuri ja seuraavat 30 päivää näkyvät.",
    });
  }
  return { signals, filed: filedWithoutAsking(ctx, range.to) };
}
