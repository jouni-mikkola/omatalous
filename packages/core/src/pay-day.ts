/**
 * Banking days and pay days: the days Finnish banks settle payments, and the day of the month a payer pays on with the
 * way a closed day moves it. Pure dates, below the analysis context, so the detection of series can read a pay day too.
 */
import { addDays, daysInMonth, monthOf, weekdayOf } from "./dates.ts";
import type { IsoDate } from "./types.ts";

/** Easter Sunday (anonymous Gregorian algorithm). */
function easter(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const holidayCache = new Map<number, Set<IsoDate>>();

/** Days Finnish banks do not settle payments, besides weekends. */
function bankHolidays(year: number): Set<IsoDate> {
  let set = holidayCache.get(year);
  if (set) return set;
  const e = easter(year);
  const fixed = ["01-01", "01-06", "05-01", "12-06", "12-24", "12-25", "12-26"].map((md) => `${year}-${md}`);
  // midsummer eve is the Friday between 19 and 25 June
  const midsummerEve = [19, 20, 21, 22, 23, 24, 25].map((d) => `${year}-06-${d}`).find((d) => weekdayOf(d) === 4)!;
  set = new Set([...fixed, addDays(e, -2), addDays(e, 1), addDays(e, 39), midsummerEve]);
  holidayCache.set(year, set);
  return set;
}

export function isBankingDay(d: IsoDate): boolean {
  return weekdayOf(d) < 5 && !bankHolidays(Number(d.slice(0, 4))).has(d);
}

/** The date moved to a banking day: back for `prev`, forward for `next`. */
export function toBankingDay(d: IsoDate, rule: PayRule): IsoDate {
  let x = d;
  while (!isBankingDay(x)) x = addDays(x, rule === "prev" ? -1 : 1);
  return x;
}

/** `n` banking days after `d`. */
export function addBankingDays(d: IsoDate, n: number): IsoDate {
  let x = d;
  for (let i = 0; i < n; i++) x = toBankingDay(addDays(x, 1), "next");
  return x;
}

/** prev: a closed day moves the payment to the banking day before (salaries, pensions); next: to the one after (Kela housing allowance). */
export type PayRule = "prev" | "next";

export interface PayDay {
  /** Day of month, 1 to 31; a day past the month's end is its last day. */
  day: number;
  rule: PayRule;
  /** Payments that fell on the date the rule gives, of the last ones checked. */
  hits: number;
  of: number;
}

export function payDate(month: string, pd: Pick<PayDay, "day" | "rule">): IsoDate {
  const day = Math.min(pd.day, daysInMonth(month));
  return toBankingDay(`${month}-${String(day).padStart(2, "0")}`, pd.rule);
}

/** At most this many latest payments decide the pay day. */
const PAY_DAY_SAMPLE = 12;

/**
 * The pay day that explains most of the payment dates: a nominal day and how a closed day moves it. Null when fewer
 * than three dates or no rule explains at least two thirds of them (a payer without a fixed day).
 */
export function payDayOf(dates: readonly IsoDate[]): PayDay | null {
  const sample = [...dates].sort().slice(-PAY_DAY_SAMPLE);
  if (sample.length < 3) return null;
  const candidates = new Map<string, Pick<PayDay, "day" | "rule">>();
  for (const d of sample) {
    const day = Number(d.slice(8, 10));
    for (let k = 0; k <= 4; k++) {
      if (day + k <= 31) candidates.set(`${day + k}p`, { day: day + k, rule: "prev" });
      if (day - k >= 1) candidates.set(`${day - k}n`, { day: day - k, rule: "next" });
    }
    if (day >= 25) candidates.set("31p", { day: 31, rule: "prev" });
  }
  let best: PayDay | null = null;
  for (const c of candidates.values()) {
    let hits = 0;
    for (const d of sample) {
      const m = monthOf(d);
      // a pay day on the 1st moved back lands in the month before
      if (payDate(m, c) === d || payDate(monthOf(addDays(`${m}-01`, 32)), c) === d) hits++;
    }
    const better = !best || hits > best.hits || (hits === best.hits && c.rule === "prev" && best.rule === "next") || (hits === best.hits && c.rule === best.rule && c.day < best.day);
    if (better) best = { ...c, hits, of: sample.length };
  }
  return best && best.hits * 3 >= best.of * 2 ? best : null;
}

/** The first pay date after `after`, by the pay day rule. */
export function nextPayDate(after: IsoDate, pd: Pick<PayDay, "day" | "rule">): IsoDate {
  let month = monthOf(after);
  for (let i = 0; i < 3; i++) {
    const d = payDate(month, pd);
    if (d > after) return d;
    month = monthOf(addDays(`${month}-01`, 32));
  }
  return payDate(month, pd);
}
