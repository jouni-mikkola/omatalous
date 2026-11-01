// Decision: whether a figure of a page can be read as the whole, or leaves something out the household should add in their head
/**
 * What a period's figures leave out, with the amount: card purchases the data does not hold (the bills of those cards
 * are in, their purchases are not), rows in another currency than the euro (kept apart, never added to euros) and the
 * days of the period before the bank's history begins. One definition for every page that shows the figure (ADR 0004):
 * a page reads `coverageNotices` from the answer and sums nothing itself.
 */
import { dayNumber, fromDayNumber } from "../dates.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { messageIn } from "../messages.ts";
import { formatForeignAmount, type ForeignTotal } from "../foreign-rows.ts";
import type { BalanceInput, IsoDate } from "../types.ts";
import { cardGapCause, missingCardPurchases } from "./card-bills.ts";
import { type AnalysisContext, COVER_SLACK_DAYS } from "./context.ts";
import { historyStart } from "./coverage.ts";
import { finnishList, formatEur, formatFiDate, formatFiRange } from "./format.ts";
import type { DateRange } from "./period.ts";

export type NoticeKind = "cards" | "currency" | "history";

/** One thing a period leaves out: `text` is the line, the rest is the amount in its parts for a reader that wants them. */
export interface CoverageNotice {
  kind: NoticeKind;
  text: string;
  /** cards: the card bills whose purchases are not seen. */
  cents?: number;
  /** currency: per currency the count and the total in the bank's own figure (null only when the sum is not a safe integer). */
  currencies?: { currency: string; count: number; totalMinor: number | null; scale: number | null; outMinor: number | null; inMinor: number | null }[];
  /** history: the days of the period before the first known day, and that day. */
  days?: number;
  from?: IsoDate;
}

/** Per currency the count and the signed total, rows of different scale brought to the finest one so the sum stays exact. */
function totalsOf(rows: readonly { currency: string; amountMinor: number; scale: number }[]): (ForeignTotal & { outMinor: number | null; inMinor: number | null })[] {
  const by = new Map<string, typeof rows[number][]>();
  for (const r of rows) by.set(r.currency, [...(by.get(r.currency) ?? []), r]);
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, list]) => {
      const scale = Math.max(...list.map((r) => r.scale));
      const part = (keep: (n: number) => boolean) => {
        const sum = list.reduce((t, r) => t + (keep(r.amountMinor) ? r.amountMinor * 10 ** (scale - r.scale) : 0), 0);
        return Number.isSafeInteger(sum) ? sum : null;
      };
      const outMinor = part((n) => n < 0);
      const inMinor = part((n) => n > 0);
      const ok = outMinor !== null && inMinor !== null;
      return { currency, count: list.length, totalMinor: ok ? outMinor + inMinor : null, scale: ok ? scale : null, outMinor, inMinor };
    });
}

const rowsText = (n: number, lang: Language): string => (n === 1 ? messageIn(lang, "rep.rows_one") : messageIn(lang, "rep.rows_many", { count: n }));
const daysText = (n: number, lang: Language): string => (n === 1 ? messageIn(lang, "rep.days_one") : messageIn(lang, "rep.days_many", { count: n }));

/**
 * The notices of `range` (cut at today), in the order cards, currency, history; none for a period that leaves nothing out.
 * `balances` only name the card in a bill's row.
 */
export function coverageNotices(ctx: AnalysisContext, range: DateRange, balances: readonly Pick<BalanceInput, "id" | "cardMask">[] = [], accountIds?: ReadonlySet<string>, lang: Language = DEFAULT_LANGUAGE): CoverageNotice[] {
  const to = range.to < ctx.today ? range.to : ctx.today;
  if (to < range.from) return [];
  const span = { from: range.from, to };
  const out: CoverageNotice[] = [];

  const bills = missingCardPurchases(ctx, span, balances);
  if (bills.length) {
    const cents = bills.reduce((s, b) => s + b.cents, 0);
    out.push({ kind: "cards", cents, text: messageIn(lang, "rep.notice_cards", { range: formatFiRange(span.from, span.to, lang), amount: formatEur(cents, false, lang), cause: String(cardGapCause(bills, lang)) }) });
  }

  const foreign = ctx.foreignRows.filter((f) => !accountIds || accountIds.has(f.accountId)).flatMap((f) => f.rows ?? []).filter((r) => r.day >= span.from && r.day <= span.to);
  if (foreign.length) {
    const totals = totalsOf(foreign);
    const parts = totals.map((t) => {
      if (t.totalMinor === null) return `${rowsText(t.count, lang)} (${t.currency})`;
      // Money out and in apart: a refund must not cancel a purchase out of the sum.
      const side = [t.outMinor, t.inMinor].filter((m) => m !== 0).map((m) => formatForeignAmount(m!, t.scale!, true, lang));
      return `${rowsText(t.count, lang)}, ${side.join(messageIn(lang, "rep.and")) || formatForeignAmount(0, t.scale!, false, lang)} ${t.currency}`;
    });
    out.push({ kind: "currency", currencies: totals, text: messageIn(lang, "rep.notice_currency", { parts: finnishList(parts, lang) }) });
  }

  const start = historyStart(ctx);
  if (start && dayNumber(start) > dayNumber(span.from) + COVER_SLACK_DAYS) {
    const last = Math.min(dayNumber(start) - 1, dayNumber(span.to));
    const days = last - dayNumber(span.from) + 1;
    out.push({ kind: "history", days, from: start, text: messageIn(lang, "rep.notice_history", { start: formatFiDate(start, lang), range: formatFiRange(span.from, fromDayNumber(last), lang), days: daysText(days, lang) }) });
  }
  return out;
}
