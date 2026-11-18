// Decision: which rows of each month Laskut lists one by one, so that a long list stays readable and no sum loses its rows
import type { ReportsData } from "../../types.ts";
import type { Item, TypedBill } from "./items.ts";

export type Calendar = ReportsData["billCalendar"];
export type CalMonth = Calendar["months"][number];
export type CalBill = CalMonth["rows"][number];

/** This month and the next list every row; the later months fold their monthly bills into one row. */
export const OPEN_MONTHS = 2;

/** The key of the group of what has ended. */
export const ENDED_GROUP = "ended";

/**
 * One row of the table: a row of the calendar, the one row that stands for a month's monthly bills (`count` and `cents`
 * are core's, `bills` the rows they add up), or what has ended.
 */
export type CalRow =
  | { key: string; kind: "row"; bill: CalBill; item: Item | null; typed: TypedBill | null; missed?: true }
  | { key: string; kind: "fold"; month: string; bills: CalBill[]; count: number; cents: number }
  | { key: string; kind: "ended"; item: Item };

export interface CalGroup {
  key: string;
  /** The month of the calendar; null for what has ended. */
  month: CalMonth | null;
  /** The rows of the group when it is open; none while it is closed. */
  rows: CalRow[];
  /** How many ended series the group of what has ended holds. */
  ended: number;
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("fi") === b.trim().toLocaleLowerCase("fi");

/** A monthly bill or loan payment still to pay that no card pays: what core's `monthlyBillsCents` adds up. */
const isMonthlyBill = (r: CalBill) => r.monthly === true && (r.kind === "bill" || r.kind === "loan") && r.state !== "paid" && !r.onCard;

/**
 * The groups of the table: a month each, in the calendar's order, then what has ended. A group in `shown` lists its
 * rows in the order of the calendar; from the third month on its monthly bills are one row that opens to them, and
 * everything else (a bill that comes less often, a pay, a saving, a bill a card pays) is listed. A group not in `shown`
 * has no rows. The row of a series carries its item, the one of a bill typed in its bill.
 */
export function calendarGroups(calendar: Calendar, items: readonly Item[], typed: readonly TypedBill[], shown: (key: string) => boolean): CalGroup[] {
  const bySeries = new Map(items.flatMap((i) => (i.series && !i.ended ? [[i.series.id, i] as const] : [])));
  // a bill that did not come is no row of the calendar (core forecasts only what is active and not late) but is still live
  // until the payments say it ended: it stands first in the month of today, and its actions stay in reach
  const inCalendar = new Set(calendar.months.flatMap((m) => m.rows.map((r) => r.seriesId)));
  const late = items.filter((i) => i.series && !i.ended && !inCalendar.has(i.series.id) && (i.missed !== null || i.series.overdue));
  const months = calendar.months.map((m, at): CalGroup => {
    const rows: CalRow[] = [];
    if (shown(m.month)) {
      if (at === 0) {
        for (const item of late) {
          const bill: CalBill = { date: item.missed ?? item.next ?? calendar.from, payee: item.name, category: item.category, cents: item.cents, state: "estimate", kind: "bill", seriesId: item.series!.id };
          rows.push({ key: `missed:${item.key}`, kind: "row", bill, item, typed: null, missed: true });
        }
      }
      const fold = at >= OPEN_MONTHS && m.monthlyBillsCount > 0;
      m.rows.forEach((bill, n) => {
        if (fold && isMonthlyBill(bill)) {
          if (!rows.some((r) => r.kind === "fold")) rows.push({ key: `${m.month}:fold`, kind: "fold", month: m.month, bills: m.rows.filter(isMonthlyBill), count: m.monthlyBillsCount, cents: m.monthlyBillsCents });
          return;
        }
        const item = bill.seriesId ? (bySeries.get(bill.seriesId) ?? null) : null;
        const own = bill.seriesId === null && bill.kind === "bill" ? (typed.find((b) => sameName(b.name, bill.payee)) ?? null) : null;
        rows.push({ key: `${m.month}:${n}`, kind: "row", bill, item, typed: own });
      });
    }
    return { key: m.month, month: m, rows, ended: 0 };
  });
  const ended = items.filter((i) => i.ended);
  if (!ended.length) return months;
  return [...months, { key: ENDED_GROUP, month: null, rows: shown(ENDED_GROUP) ? ended.map((item): CalRow => ({ key: item.key, kind: "ended", item })) : [], ended: ended.length }];
}
