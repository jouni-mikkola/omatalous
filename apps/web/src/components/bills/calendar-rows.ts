// Decision: which rows of each month Laskut lists one by one, so that a long list stays readable and no sum loses its rows
import { unknownBillsIn } from "@banking/core";
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
  | { key: string; kind: "ended"; item: Item }
  | { key: string; kind: "total"; total: TotalName; figure: TotalFigure; cents: number | null; parts?: { total: TotalName; cents: number }[]; unknown?: number };

/** What a total is, as its colour says: `now` is charged already, `estimate` is still to come. */
type TotalFigure = "now" | "estimate";

/** The kinds core adds a month's bills up by (`costKindOf`): parts of the month's bills still to come. */
const PARTS = [
  ["essential", "essentialCents"],
  ["debt", "debtCents"],
  ["contract", "contractCents"],
  ["optional", "optionalCents"],
] as const;

/** The figure a closing row of an open month tells. */
type TotalName = "paid" | "coming" | "saving" | "income" | "after" | (typeof PARTS)[number][0];

export interface CalGroup {
  key: string;
  /** The month of the calendar; null for what has ended. */
  month: CalMonth | null;
  /**
   * Rows of an open month, two or more of one kind, in a group of their own under a toggle: the paid ones, or the ones a card
   * pays that are still to come. The keys of those rows, shown or not.
   */
  fold?: { kind: FoldKind; keys: string[] };
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

/** What a folded group of a month holds: its paid rows, or its rows still to come that a card pays. */
type FoldKind = "paid" | "card";

/** The key of the group of a month's rows of one fold. */
const foldGroupKey = (month: string, kind: FoldKind) => `${month}:${kind}`;

/** A month with this many rows of one fold or more lists them in a group of their own, closed until the reader opens it. */
const FOLDED_ROWS = 2;

/**
 * The totals that close an open month, one for each figure of core's that the rows above add up to: what is paid (`paidCents`) and
 * the saving charged (`savingPaidCents`), both only when a charge is made, so only the running month has them, then what is still to
 * come (`billsCents`) and the saving still to come (`savingCents`), each only when the month has it. Every listed row is in one of them
 * (or is a card's and in none). The pays are no listed rows, only their total, and they less the two to come are the sum left after the bills.
 * The bills still to come carry their parts by kind while two kinds or more have money (one kind alone is the sum
 * itself); the table shows them in the figure panel of the sum. The pays (`incomeCents`) and what is left after the bills (`afterCents`) close the month: the sum left is there while
 * something is still to come, and is null while a bill's sum is not known or no pay comes, with the count of the bills that
 * leave it unknown (`unknownBillsIn` of core).
 */
function totalRows(calendar: Calendar, m: CalMonth): CalRow[] {
  const total = (total: TotalName, figure: TotalFigure, cents: number | null): Extract<CalRow, { kind: "total" }> => ({ key: `${m.month}:total:${total}:${figure}`, kind: "total", total, figure, cents });
  const parts = PARTS.filter(([, field]) => m[field] > 0);
  return [
    ...(m.paidCents > 0 ? [total("paid", "now", m.paidCents)] : []),
    ...(m.savingPaidCents > 0 ? [total("saving", "now", m.savingPaidCents)] : []),
    { ...total("coming", "estimate", m.billsCents), ...(parts.length > 1 ? { parts: parts.map(([name, field]) => ({ total: name, cents: m[field] })) } : {}) },
    ...(m.savingCents > 0 ? [total("saving", "estimate", m.savingCents)] : []),
    ...(m.incomeCents > 0 ? [total("income", "estimate", m.incomeCents)] : []),
    ...(nothingToCome(m) ? [] : [{ ...total("after", "estimate", m.afterCents), unknown: unknownBillsIn(calendar, [m.month]) }]),
  ];
}

/**
 * The groups of the table: a month each, in the calendar's order, then what has ended. A group in `shown` lists its
 * rows in the order of the calendar, then the month's totals; from the third month on its monthly bills are one row that opens to them, and
 * everything else (a bill that comes less often, a saving, a bill a card pays; the pays are only the month's total) is listed. A group not in `shown`
 * has no rows. An open month with two rows or more that a card pays and are still to come, or with two paid rows or more,
 * lists the rest first, then each of those in a group of its own (`foldGroupKey`): the card's rows, then the paid ones.
 * The rows of such a group are listed while it is in `shown`. The row of a series carries its item, the one of a bill
 * typed in its bill.
 */
export function calendarGroups(calendar: Calendar, items: readonly Item[], typed: readonly TypedBill[], shown: (key: string) => boolean): CalGroup[] {
  const bySeries = new Map(items.flatMap((i) => (i.series && !i.ended ? [[i.series.id, i] as const] : [])));
  const late = lateItems(calendar, items);
  const months = calendar.months.flatMap((m, at): CalGroup[] => {
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
        // the pays are the Tulot total of the month, not rows of the bills
        if (bill.kind === "income") return;
        if (fold && isMonthlyBill(bill)) {
          if (!rows.some((r) => r.kind === "fold")) rows.push({ key: `${m.month}:fold`, kind: "fold", month: m.month, bills: m.rows.filter(isMonthlyBill), count: m.monthlyBillsCount, cents: m.monthlyBillsCents });
          return;
        }
        const item = bill.seriesId ? (bySeries.get(bill.seriesId) ?? null) : null;
        const own = bill.seriesId === null && bill.kind === "bill" ? (typed.find((b) => sameName(b.name, bill.payee)) ?? null) : null;
        rows.push({ key: `${m.month}:${n}`, kind: "row", bill, item, typed: own });
      });
      rows.push(...totalRows(calendar, m));
    }
    const folds = (
      [
        ["card", rows.filter((r) => r.kind === "row" && r.bill.onCard === true && r.bill.state !== "paid" && !r.missed)],
        ["paid", rows.filter((r) => r.kind === "row" && r.bill.state === "paid")],
      ] as const
    ).filter(([, folded]) => folded.length >= FOLDED_ROWS);
    const inFolds = new Set<CalRow>(folds.flatMap(([, folded]) => folded));
    return [
      { key: m.month, month: m, rows: rows.filter((r) => !inFolds.has(r)), ended: 0 },
      ...folds.map(([kind, folded]): CalGroup => {
        const key = foldGroupKey(m.month, kind);
        return { key, month: m, fold: { kind, keys: folded.map((r) => r.key) }, rows: shown(key) ? [...folded] : [], ended: 0 };
      }),
    ];
  });
  const ended = items.filter((i) => i.ended);
  if (!ended.length) return months;
  return [...months, { key: ENDED_GROUP, month: null, rows: shown(ENDED_GROUP) ? ended.map((item): CalRow => ({ key: item.key, kind: "ended", item })) : [], ended: ended.length }];
}
