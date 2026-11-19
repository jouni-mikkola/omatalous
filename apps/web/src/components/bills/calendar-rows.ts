// Decision: which rows of each month Laskut lists one by one, so that a long list stays readable and no sum loses its rows
import type { ReportsData } from "../../types.ts";
import type { Item, TypedBill } from "./items.ts";

export type Calendar = ReportsData["billCalendar"];
export type CalMonth = Calendar["months"][number];
export type CalBill = CalMonth["rows"][number];

/** This month and the next list every row once opened; the later months fold their monthly bills into one row. */
const UNFOLDED_MONTHS = 2;

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

/**
 * A month with nothing left to come: no bill to pay, no pay, no saving, and so nothing after the bills to tell. A month with a sum
 * that is not known (`afterCents` null) is not this: it says so.
 */
export const nothingToCome = (m: CalMonth) => m.afterCents === 0 && m.billsCents === 0 && m.incomeCents === 0 && m.savingCents === 0;

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("fi") === b.trim().toLocaleLowerCase("fi");

/** A monthly bill or loan payment still to pay that no card pays: what core's `monthlyBillsCents` adds up. */
const isMonthlyBill = (r: CalBill) => r.monthly === true && (r.kind === "bill" || r.kind === "loan") && r.state !== "paid" && !r.onCard;

/**
 * The bills that did not come: no row of the calendar (core forecasts only what is active and not late) but still live until
 * the payments say they ended. They stand first in the month of today, so their actions stay in reach.
 */
function lateItems(calendar: Calendar, items: readonly Item[]): Item[] {
  const inCalendar = new Set(calendar.months.flatMap((m) => m.rows.map((r) => r.seriesId)));
  return items.filter((i) => i.series && !i.ended && !inCalendar.has(i.series.id) && (i.missed !== null || i.series.overdue));
}

/**
 * The one month that starts open: the running month while a bill or loan payment of it is still to pay (not paid, as core's
 * `toPay`) or a bill of it did not come, otherwise the next month.
 */
export function startOpenMonth(calendar: Calendar, items: readonly Item[]): string | null {
  const [running, next] = calendar.months;
  if (!running) return null;
  const unpaid = running.rows.some((r) => (r.kind === "bill" || r.kind === "loan") && r.state !== "paid") || lateItems(calendar, items).length > 0;
  return unpaid || !next ? running.month : next.month;
}

/**
 * The groups of the table: a month each, in the calendar's order, then what has ended. A group in `shown` lists its
 * rows in the order of the calendar; from the third month on its monthly bills are one row that opens to them, and
 * everything else (a bill that comes less often, a pay, a saving, a bill a card pays) is listed. A group not in `shown`
 * has no rows. The row of a series carries its item, the one of a bill typed in its bill.
 */
export function calendarGroups(calendar: Calendar, items: readonly Item[], typed: readonly TypedBill[], shown: (key: string) => boolean): CalGroup[] {
  const bySeries = new Map(items.flatMap((i) => (i.series && !i.ended ? [[i.series.id, i] as const] : [])));
  const late = lateItems(calendar, items);
  const months = calendar.months.map((m, at): CalGroup => {
    const rows: CalRow[] = [];
    if (shown(m.month)) {
      if (at === 0) {
        for (const item of late) {
          const bill: CalBill = { date: item.missed ?? item.next ?? calendar.from, payee: item.name, category: item.category, cents: item.cents, state: "estimate", kind: "bill", seriesId: item.series!.id };
          rows.push({ key: `missed:${item.key}`, kind: "row", bill, item, typed: null, missed: true });
        }
      }
      const fold = at >= UNFOLDED_MONTHS && m.monthlyBillsCount > 0;
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
