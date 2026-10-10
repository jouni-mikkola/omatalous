import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { formatEur, formatFiDate } from "../analysis/format.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { daysBetween } from "../dates.ts";

export type QualityTone = "warning" | "info";

export interface QualitySignal {
  id: "short_history" | "uncategorised" | "gap" | "stale" | "card_bills";
  tone: QualityTone;
  title: string;
  detail: string;
  /** A link target the page can offer: a category id for the transaction list. */
  category?: string;
}

export interface DataQualityReport {
  signals: QualitySignal[];
}

const SHORT_HISTORY_DAYS = 90;
// 5 % of a family's spending is often the third largest category
const UNCATEGORISED_SHARE = 0.05;
const GAP_DAYS = 14;
const STALE_DAYS = 7;
/** Only these accounts are checked for gaps: a savings account can be silent for months. */
const ACTIVE_TYPES = new Set(["checking", "credit_card"]);

/**
 * Where the numbers on the reports may be shaky: a short history, rows no rule
 * recognised, a hole in the fetched dates, card bills counted as spending.
 * Each signal says what is wrong and what it does to the figures.
 */
export function dataQualityReport(ctx: AnalysisContext, range: DateRange): DataQualityReport {
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
        detail: `Tapahtumat alkavat ${formatFiDate(ctx.dataFrom)}. Vertailut, keskiarvot ja toistuvien maksujen tunnistus tarkentuvat, kun historiaa on vähintään kolme kuukautta.`,
      });
    }
  }

  const spending = inRange.reduce((s, t) => s + Math.max(0, t.spend), 0);
  const other = inRange.filter((t) => t.category === "other").reduce((s, t) => s + t.spend, 0);
  if (spending > 0 && other / spending >= UNCATEGORISED_SHARE) {
    const byMerchant = new Map<string, number>();
    for (const t of inRange) if (t.category === "other" && t.spend > 0) byMerchant.set(t.merchant, (byMerchant.get(t.merchant) ?? 0) + t.spend);
    const top = [...byMerchant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m);
    signals.push({
      id: "uncategorised",
      tone: "warning",
      title: `${Math.round((other / spending) * 100)} % menoista on luokittelematta`,
      detail: `${formatEur(other, false)} on kategoriassa Muut menot${top.length ? `, suurimpina ${top.join(", ")}` : ""}. Luokittele kauppiaat, niin kategoriat ja vertailut tarkentuvat.`,
      category: "other",
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
        detail: `Väliltä ${formatFiDate(widest.from)} ja ${formatFiDate(widest.to)} ei ole yhtään tapahtumaa. Jos tilillä oli tapahtumia, hae tai tuo puuttuva jakso.`,
      });
    }
    const last = dates[dates.length - 1]!;
    if (daysBetween(last, ctx.today) > STALE_DAYS && range.to >= last) {
      signals.push({
        id: "stale",
        tone: "info",
        title: `Tilin ${account.name} viimeinen tapahtuma on ${formatFiDate(last)}`,
        detail: "Uudempia tapahtumia ei ole haettu. Jakson loppupään luvut voivat olla vajaat.",
      });
    }
  }

  const hasCardAccount = ctx.accounts.some((a) => a.type === "credit_card");
  if (!hasCardAccount) {
    const bills = inRange.filter((t) => t.category === "card_bill" && t.spend > 0);
    const total = bills.reduce((s, t) => s + t.spend, 0);
    if (total > 0) {
      signals.push({
        id: "card_bills",
        tone: "warning",
        title: `Korttilaskuja ${formatEur(total, false)} lasketaan menoiksi`,
        detail: "Luottokorttitiliä ei ole yhdistetty, joten ostoksia ei näy kategorioittain. Yhdistä kortti tai tuo sen tapahtumat, niin laskut muuttuvat siirroiksi ja ostokset jakautuvat kategorioihin.",
        category: "card_bill",
      });
    }
  }
  return { signals };
}
