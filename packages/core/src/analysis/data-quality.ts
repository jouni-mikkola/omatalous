import { type AnalysisContext, type AnalysisTx, inDays, loweredRows } from "./context.ts";
import { finnishList, formatEur, formatFiDate } from "./format.ts";
import { type DateRange, toDayRange } from "./period.ts";
import { daysBetween } from "../dates.ts";
import type { BalanceInput } from "../types.ts";

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
}

export interface DataQualityReport {
  signals: QualitySignal[];
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

/** A row of a card bill that counts as spending: the rows the card_bills signal adds up. */
export const isCardBill = (t: Pick<AnalysisTx, "category" | "spend">): boolean => t.category === "card_bill" && t.spend > 0;

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

  const spending = spendingBase(inRange);
  const other = inRange.filter((t) => t.category === "other").reduce((s, t) => s + t.spend, 0);
  if (spending > 0 && other / spending >= UNCATEGORISED_SHARE) {
    const byMerchant = new Map<string, number>();
    for (const t of inRange) if (t.category === "other" && t.spend > 0) byMerchant.set(t.merchant, (byMerchant.get(t.merchant) ?? 0) + t.spend);
    const top = [...byMerchant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m);
    signals.push({
      id: "uncategorised",
      tone: "warning",
      title: `${Math.round((other / spending) * 100)} % menoista on luokittelematta`,
      detail: `${formatEur(other, false)} on kategoriassa Muut menot${top.length ? `, suurimpina ${top.join(", ")}` : ""}. Luokittele kauppiaat, niin vertailut tarkentuvat.`,
      category: "other",
      cents: other,
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
        detail: "Uudempia tapahtumia ei ole haettu. Jakson loppupään luvut voivat olla vajaat.",
      });
    }
  }

  // with a card connected the bills are of the months before its rows, or of a card that is not connected
  const hasCardAccount = ctx.accounts.some((a) => a.type === "credit_card");
  const billTotal = loweredRows(ctx, inRange).filter(isCardBill).reduce((s, t) => s + t.spend, 0);
  if (billTotal > 0) {
    signals.push({
      id: "card_bills",
      tone: "warning",
      title: `Korttilaskuja ${formatEur(billTotal, false)} lasketaan menoiksi`,
      detail: hasCardAccount ? "Laskut ovat ajalta ennen kortin tapahtumia tai kortista, jota ei ole yhdistetty." : "Kortin ostot eivät näy kategorioittain. Yhdistä kortti.",
      category: "card_bill",
      cents: billTotal,
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
      title: `${formatEur(saved, false)} säästöjä meni tilille, jonka saldo ei näy`,
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
  return { signals };
}
