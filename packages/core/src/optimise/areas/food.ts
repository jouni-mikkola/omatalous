/**
 * Ruoka: eating out and food delivery against the same months a year earlier (F 3.5). Only the household's own months
 * count: the last six complete months against the six a year before, each month's net purchases with one-offs struck,
 * so 18 complete months are needed. A rise must clear 25 % and 30 € a month on the medians and stand out from the
 * household's month-to-month noise on the means (`clearlyAbove`, the insights' test), so a noisy month or a party never
 * makes it.
 * Payments to people are never food, even when a MobilePay to a friend was filed under restaurants.
 */
import type { AnalysisContext, AnalysisTx } from "../../analysis/context.ts";
import { netPurchase, paidToPerson } from "../../analysis/context.ts";
import type { Language } from "../../locale.ts";
import { messageIn } from "../../messages.ts";
import { formatEur, formatFiDate } from "../../analysis/format.ts";
import { capitalise, monthSpan } from "../../analysis/insights/shared.ts";
import { clearlyAbove } from "../../analysis/signal.ts";
import { monthOf } from "../../dates.ts";
import { UNKNOWN_MERCHANT } from "../../merchant.ts";
import { median } from "../../stats.ts";
import { accountsBefore, EATING_OUT_CLAIMS, eur, findingId, formatCount, GATE_YEARLY_CENTS, levelWithoutOneOffs, MAX_ROWS, mean, whyHistory, YEAR_OVER_YEAR_NEED, YEAR_OVER_YEAR_SIDE, yearOverYear } from "../common.ts";
import type { Area, AreaInput, CalcLine, Check, FindingDraft, NoDataWhy } from "../types.ts";

const EATING_OUT: ReadonlySet<string> = new Set(["restaurants", "food_delivery"]);

const MIN_RISE_SHARE = 0.25;
const MIN_RISE_MONTHLY = 3000;
const MIN_EATING_OUT_YEARLY = 30000;
const MIN_ORDER_RISE_SHARE = 0.5;
const MIN_ORDER_RISE = 3;

/** Eating-out rows of the months on accounts that existed before them, payments to people left out. */
function eatingOutRows(ctx: AnalysisContext, months: readonly string[]): AnalysisTx[] {
  const inMonths = new Set(months);
  const accounts = accountsBefore(ctx, `${months[0]}-01`);
  return ctx.txs.filter(
    (t) => EATING_OUT.has(t.category) && !t.isTransfer && netPurchase(t) > 0 && accounts.has(t.accountId) && inMonths.has(monthOf(t.bookingDate)) && !paidToPerson(t),
  );
}

/** The struck rows as calc lines, largest first, at most five. */
function struckLines(rows: readonly AnalysisTx[], struck: ReadonlySet<string>, lang: Language): CalcLine[] {
  return rows
    .filter((t) => struck.has(t.id))
    .sort((x, y) => netPurchase(y) - netPurchase(x))
    .slice(0, 5)
    .map((t) => ({ label: messageIn(lang, "opt.c_one_off_at", { merchant: t.merchant, date: formatFiDate(t.bookingDate, lang) }), value: formatEur(netPurchase(t), true, lang), struck: true }));
}

/** Evidence ids, at most `MAX_ROWS`: the struck rows first, then the latest counted ones. */
function evidence(rows: readonly AnalysisTx[], struck: ReadonlySet<string>): { rows: string[]; struck: string[] } {
  const out = rows.filter((t) => struck.has(t.id)).slice(0, 10);
  const counted = rows.filter((t) => !struck.has(t.id));
  out.push(...counted.slice(Math.max(0, counted.length - (MAX_ROWS - out.length))));
  return { rows: out.map((t) => t.id), struck: out.filter((t) => struck.has(t.id)).map((t) => t.id) };
}

function eatingOut(a: AreaInput, win: { now: string[]; then: string[]; all: string[] }, rows: readonly AnalysisTx[]): FindingDraft | null {
  const lang = a.lang;
  const level = levelWithoutOneOffs(rows, win.all);
  const at = (m: string) => level.byMonth[win.all.indexOf(m)]!;
  const now = win.now.map(at);
  const then = win.then.map(at);
  const nowLevel = Math.round(median(now));
  const thenLevel = Math.round(median(then));
  // a level from nothing is a new card or a new category, not a rise
  if (thenLevel <= 0 || nowLevel < (1 + MIN_RISE_SHARE) * thenLevel || nowLevel - thenLevel < MIN_RISE_MONTHLY || !clearlyAbove(now, then)) return null;
  const midCents = (nowLevel - thenLevel) * 12;
  if (midCents < Math.max(GATE_YEARLY_CENTS, MIN_EATING_OUT_YEARLY)) return null;
  const recent = a.months.slice(-12).map(at);
  const cheapest = Math.round(mean([...recent].sort((x, y) => x - y).slice(0, 3)));
  const highCents = Math.max(midCents, (nowLevel - cheapest) * 12);
  const nowSpan = capitalise(monthSpan(win.now[0]!, win.now[YEAR_OVER_YEAR_SIDE - 1]!, lang));
  const thenSpan = capitalise(monthSpan(win.then[0]!, win.then[YEAR_OVER_YEAR_SIDE - 1]!, lang));
  const struck = new Set(level.struck);
  const shown = rows.filter((t) => win.now.includes(monthOf(t.bookingDate)) || win.then.includes(monthOf(t.bookingDate)));
  const ev = evidence(shown, struck);
  return {
    id: findingId("food", "eating_out"),
    area: "food",
    kind: "eating_out",
    subject: null,
    title: messageIn(lang, "opt.food_eo_title", { now: eur(nowLevel, lang), then: eur(thenLevel, lang), span: nowSpan }),
    action: messageIn(lang, "opt.food_eo_action", { then: eur(thenLevel, lang) }),
    euros: { lowCents: Math.round(midCents / 2), midCents, highCents },
    decideBy: null,
    weaknesses: [{ id: "estimate", reason: messageIn(lang, "opt.food_household") }],
    shared: false,
    calc: [
      { label: messageIn(lang, "opt.c_expected_month", { span: nowSpan }), value: eur(nowLevel, lang) },
      { label: messageIn(lang, "opt.c_expected_month", { span: thenSpan }), value: eur(thenLevel, lang) },
      { label: messageIn(lang, "opt.food_cheapest"), value: eur(cheapest, lang) },
      { label: messageIn(lang, "opt.c_diff_year"), value: eur(midCents, lang) },
      ...struckLines(shown, struck, lang),
    ],
    rows: ev.rows,
    struck: ev.struck,
    claims: EATING_OUT_CLAIMS,
    measure: { kind: "category", keys: ["restaurants", "food_delivery"] },
    facts: [],
  };
}

/** Orders a month of each side for the rows given. */
function ordersByMonth(rows: readonly AnalysisTx[], months: readonly string[]): number[] {
  const at = new Map(months.map((m, i) => [m, i]));
  const out = months.map(() => 0);
  for (const t of rows) {
    const i = at.get(monthOf(t.bookingDate));
    if (i !== undefined) out[i]! += 1;
  }
  return out;
}

/** Whether orders rose 50 % and by three a month, and clearly beyond the month-to-month swing. */
function ordersRose(now: readonly number[], then: readonly number[]): boolean {
  const n = mean(now);
  const p = mean(then);
  return n >= (1 + MIN_ORDER_RISE_SHARE) * p && n - p >= MIN_ORDER_RISE && clearlyAbove(now, then);
}

function delivery(a: AreaInput, win: { now: string[]; then: string[]; all: string[] }, rows: readonly AnalysisTx[]): FindingDraft[] {
  const lang = a.lang;
  const side = [...win.then, ...win.now];
  const level = levelWithoutOneOffs(rows, side);
  const struck = new Set(level.struck);
  const orders = rows.filter((t) => t.category === "food_delivery" && t.merchant !== UNKNOWN_MERCHANT && side.includes(monthOf(t.bookingDate)) && !struck.has(t.id));
  // a switch from one service to another is no rise: delivery as a whole must have risen too
  const allNow = ordersByMonth(orders, win.now);
  const allThen = ordersByMonth(orders, win.then);
  if (!ordersRose(allNow, allThen)) return [];
  const out: FindingDraft[] = [];
  for (const merchant of [...new Set(orders.map((t) => t.merchant))].sort()) {
    const own = orders.filter((t) => t.merchant === merchant);
    const now = ordersByMonth(own, win.now);
    const then = ordersByMonth(own, win.then);
    if (!ordersRose(now, then)) continue;
    const nowOrders = mean(now);
    const thenOrders = mean(then);
    const rise = Math.min(nowOrders - thenOrders, mean(allNow) - mean(allThen));
    const recent = own.filter((t) => win.now.includes(monthOf(t.bookingDate)));
    const ticket = Math.round(mean(recent.map(netPurchase)));
    const midCents = Math.round(rise * ticket * 12);
    if (midCents < GATE_YEARLY_CENTS) continue;
    const highCents = Math.max(midCents, Math.round((nowOrders - thenOrders) * ticket * 12));
    const nowSpan = capitalise(monthSpan(win.now[0]!, win.now[YEAR_OVER_YEAR_SIDE - 1]!, lang));
    const thenSpan = capitalise(monthSpan(win.then[0]!, win.then[YEAR_OVER_YEAR_SIDE - 1]!, lang));
    const shown = rows.filter((t) => t.merchant === merchant && side.includes(monthOf(t.bookingDate)));
    const ev = evidence(shown, struck);
    const calc: CalcLine[] = [
      { label: messageIn(lang, "opt.food_times_month", { span: nowSpan }), value: formatCount(nowOrders, lang) },
      { label: messageIn(lang, "opt.food_times_month", { span: thenSpan }), value: formatCount(thenOrders, lang) },
    ];
    if (Math.abs(rise - (nowOrders - thenOrders)) > 1e-9) calc.push({ label: messageIn(lang, "opt.food_more_deliveries"), value: formatCount(mean(allNow) - mean(allThen), lang) });
    calc.push({ label: messageIn(lang, "opt.c_ticket"), value: formatEur(ticket, true, lang) }, { label: messageIn(lang, "opt.c_diff_year"), value: eur(midCents, lang) }, ...struckLines(shown, struck, lang));
    out.push({
      id: findingId("food", "delivery", merchant),
      area: "food",
      kind: "delivery",
      subject: merchant,
      title: messageIn(lang, "opt.food_del_title", { merchant, now: formatCount(nowOrders, lang), then: formatCount(thenOrders, lang), ticket: formatEur(ticket, true, lang), span: monthSpan(win.now[0]!, win.now[YEAR_OVER_YEAR_SIDE - 1]!, lang) }),
      action: messageIn(lang, "opt.food_del_action", { then: formatCount(thenOrders, lang) }),
      euros: { lowCents: Math.round(midCents / 2), midCents, highCents },
      decideBy: null,
      weaknesses: [],
      shared: false,
      calc,
      rows: ev.rows,
      struck: ev.struck,
      claims: [...EATING_OUT_CLAIMS, `merchant:${merchant}`],
      measure: { kind: "merchants", keys: [merchant] },
      facts: [],
    });
  }
  return out;
}

export const food: Area = {
  id: "food",
  label: "Ruoka",
  assess: (a) => {
    const win = yearOverYear(a);
    const checks = (status: Check["status"], why?: NoDataWhy): Check[] => [
      { id: "food:eating_out", label: messageIn(a.lang, "opt.food_chk_eo"), status, ...(why ? { why } : {}) },
      { id: "food:delivery", label: messageIn(a.lang, "opt.food_chk_del"), status, ...(why ? { why } : {}) },
    ];
    if (!win) return { findings: [], checks: checks("no_data", whyHistory(a, YEAR_OVER_YEAR_NEED)) };
    const rows = eatingOutRows(a.ctx, win.all);
    const findings = [eatingOut(a, win, rows), ...delivery(a, win, rows)].filter((f): f is FindingDraft => f !== null);
    // no restaurant or delivery row at all: nothing was looked at
    const [out, orders] = checks("clear");
    return { findings, checks: [rows.length ? out! : { ...out!, status: "no_subject" }, rows.some((t) => t.category === "food_delivery") ? orders! : { ...orders!, status: "no_subject" }] };
  },
};
