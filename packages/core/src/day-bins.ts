/**
 * The histogram of a filtered list of rows: what its days add up to, in bins a small chart can draw. Decision: which
 * days or weeks of the period took the money, so the household knows where in the list to look.
 */
import { addDays, dayNumber, daysBetween, fromDayNumber } from "./dates.ts";
import { dayHeat } from "./reports/days.ts";
import type { IsoDate } from "./types.ts";

interface DayMoney {
  date: IsoDate;
  count: number;
  /** Positive cents, own transfers left out. */
  inCents: number;
  outCents: number;
}

type BinUnit = "day" | "week" | "month";

export interface MoneyBin {
  /** The first day of the bin; a week starts on Monday, a month on its first. */
  start: IsoDate;
  count: number;
  inCents: number;
  outCents: number;
}

/** At most this many bins: a day per bin up to three months, then weeks up to two years, then months. */
const DAY_BINS = 92;
const WEEK_BINS = 106;

const weekday = (d: IsoDate): number => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
const binStart = (d: IsoDate, unit: BinUnit): IsoDate => (unit === "day" ? d : unit === "week" ? addDays(d, -weekday(d)) : `${d.slice(0, 7)}-01`);
const monthIndex = (d: IsoDate): number => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
const monthStart = (i: number): IsoDate => `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}-01`;

/**
 * The first day of every bin from `from` to `to`. The loops count days and months as numbers: on strings "10000-01-01"
 * sorts before "9999-12-31", and a loop on string order never ended.
 */
function binStarts(from: IsoDate, to: IsoDate, unit: BinUnit): IsoDate[] {
  const out: IsoDate[] = [];
  if (unit === "month") {
    for (let i = monthIndex(from), last = monthIndex(to); i <= last; i++) out.push(monthStart(i));
    return out;
  }
  const step = unit === "week" ? 7 : 1;
  for (let n = dayNumber(binStart(from, unit)), last = dayNumber(to); n <= last; n += step) out.push(fromDayNumber(n));
  return out;
}

/**
 * Every bin from `from` to `to` (both included), empty ones too, so the chart's time axis has no gaps. The bins add up
 * to the days given, to the cent. Days outside the span are left out.
 */
export function moneyBins(days: readonly DayMoney[], from: IsoDate, to: IsoDate): { unit: BinUnit; bins: MoneyBin[] } {
  if (to < from) return { unit: "day", bins: [] };
  const span = daysBetween(from, to) + 1;
  const unit: BinUnit = span <= DAY_BINS ? "day" : span <= WEEK_BINS * 7 ? "week" : "month";
  const bins = new Map<IsoDate, MoneyBin>();
  for (const d of binStarts(from, to, unit)) bins.set(d, { start: d, count: 0, inCents: 0, outCents: 0 });
  for (const day of days) {
    if (day.date < from || day.date > to) continue;
    const bin = bins.get(binStart(day.date, unit))!;
    bin.count += day.count;
    bin.inCents += day.inCents;
    bin.outCents += day.outCents;
  }
  return { unit, bins: [...bins.values()] };
}

/** One calendar month of a payee: its rows, the money out and the mean purchase (null for a month with none). */
interface MerchantMonth {
  month: string;
  count: number;
  outCents: number;
  meanCents: number | null;
}

const mean = (cents: number, count: number): number | null => (count ? Math.round(cents / count) : null);

/**
 * The twelve months of a payee up to the month of its newest row, oldest first, and what they add up to: the row drill
 * of Tapahtumat. Decision: is this payee a habit, and is this row like its others. `outByMonth` and `countByMonth`
 * leave own transfers out.
 */
export function merchantMonths(outByMonth: Readonly<Record<string, number>>, countByMonth: Readonly<Record<string, number>>, lastDate: IsoDate): { months: MerchantMonth[]; year: Omit<MerchantMonth, "month"> } {
  let y = Number(lastDate.slice(0, 4));
  let m = Number(lastDate.slice(5, 7));
  const months: MerchantMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    const count = countByMonth[month] ?? 0;
    const outCents = outByMonth[month] ?? 0;
    months.unshift({ month, count, outCents, meanCents: mean(outCents, count) });
    if (--m === 0) [y, m] = [y - 1, 12];
  }
  let count = 0;
  let outCents = 0;
  for (const x of months) {
    count += x.count;
    outCents += x.outCents;
  }
  return { months, year: { count, outCents, meanCents: mean(outCents, count) } };
}

/**
 * The short mark of an account on a row: the last four of its card mask or IBAN as the bank sent them, null when it
 * sent fewer than four. The web shows "•• 4242" and never parses an IBAN itself.
 */
export function accountDigits(a: { cardMask?: string | null; iban?: string | null }): string | null {
  const s = (a.cardMask || a.iban || "").replace(/[^0-9A-Za-z]/g, "");
  return s.length >= 4 ? s.slice(-4) : null;
}

/** The calendar of a filtered list: the last 53 weeks of the span at most, Monday first. */
const CALENDAR_DAYS = 371;

/**
 * Every day of the end of a filtered list's span, a day with no row at 0, each with its shade against the usual day
 * (`dayHeat`): the rhythm calendar beside the strip of Tapahtumat. `income` shades the money in, else the money out.
 * Decision: on which days of the week and of the month the money of this filter goes.
 */
export function calendarDays(days: readonly DayMoney[], from: IsoDate, to: IsoDate, today: IsoDate, income: boolean): { days: { date: IsoDate; cents: number; count: number; heat: number }[]; usualCents: number | null } {
  if (to < from) return { days: [], usualCents: null };
  const back = addDays(to, -(CALENDAR_DAYS - 1));
  const start = back > from ? back : from;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const series: { date: IsoDate; cents: number; count: number }[] = [];
  for (let n = dayNumber(start), last = dayNumber(to); n <= last; n++) {
    const d = fromDayNumber(n);
    const x = byDate.get(d);
    series.push({ date: d, cents: x ? (income ? x.inCents : x.outCents) : 0, count: x?.count ?? 0 });
  }
  const { usualCents, heat } = dayHeat(series, today);
  return { days: series.map((d, i) => ({ ...d, heat: heat[i]! })), usualCents };
}
