/**
 * Pienet tavat: merchants the habit alert names (at least 8 small purchases a month) whose visits grew against the same
 * months a year earlier (F 3.12). The candidates come from `habitItems`, the alert's own detector, so the overview and
 * Optimoi name the same merchants. A steady habit is no finding: its quietest months are noise and holidays, so only a
 * rise counts, by the eating-out test on the median visits of the last six complete months against the same six a year
 * before. Small purchases of the same category must have risen too, so a move from one kiosk to another is no rise,
 * and a month without any row on the merchant's accounts is a gap that drops the comparison.
 */
import { habitItems } from "../../analysis/alerts.ts";
import type { AnalysisTx } from "../../analysis/context.ts";
import { netPurchase } from "../../analysis/context.ts";
import { formatEur, formatFiDate } from "../../analysis/format.ts";
import { capitalise, monthSpan } from "../../analysis/insights/shared.ts";
import { clearlyAbove } from "../../analysis/signal.ts";
import { addDays, monthOf } from "../../dates.ts";
import { median } from "../../stats.ts";
import { accountsBefore, EATING_OUT_CLAIMS, findingId, formatCount, levelWithoutOneOffs, MAX_ROWS, mean, yearOverYear } from "../common.ts";
import type { Area, AreaInput, CalcLine, Check, FindingDraft } from "../types.ts";

/** The alert's window: the habit is judged on the last 90 days of complete months. */
const HABIT_DAYS = 90;
/** The alert's small purchase: a median under 10 €. Purchases under this count for the category's rise. */
const SMALL_CENTS = 1000;
const MIN_RISE_SHARE = 0.5;
const MIN_RISE = 3;
const MIN_HABIT_YEARLY = 20000;
/** Visits on weekdays at this share or more may be workday purchases: one step lower. */
const WEEKDAY_SHARE = 0.8;
const NOT_A_HABIT: ReadonlySet<string> = new Set(["p2p", "cash"]);
const FOOD: ReadonlySet<string> = new Set(["restaurants", "food_delivery"]);

const eur = (cents: number) => formatEur(cents, false);

/** The category most of the rows have; ties by id so the result does not depend on row order. */
function mainCategory(rows: readonly AnalysisTx[]): string {
  const counts = new Map<string, number>();
  for (const t of rows) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]![0];
}

function countsBy(rows: readonly AnalysisTx[], months: readonly string[]): number[] {
  const at = new Map(months.map((m, i) => [m, i]));
  const out = months.map(() => 0);
  for (const t of rows) {
    const i = at.get(monthOf(t.bookingDate));
    if (i !== undefined) out[i]! += 1;
  }
  return out;
}

/** Medians a month now and a year earlier, when the rise clears 50 %, three visits a month and the noise test. */
function rise(now: readonly number[], then: readonly number[]): { now: number; then: number } | null {
  const n = median(now);
  const p = median(then);
  // from nothing is a new place or missing data, never a habit that grew
  if (p <= 0 || n < (1 + MIN_RISE_SHARE) * p || n - p < MIN_RISE || !clearlyAbove(now, then)) return null;
  return { now: n, then: p };
}

function habitFinding(a: AreaInput, merchant: string, win: { now: string[]; then: string[] }): FindingDraft | null {
  const months = [...win.then, ...win.now];
  const inWindow = new Set(months);
  const accounts = accountsBefore(a.ctx, `${win.then[0]}-01`);
  const counted = (t: AnalysisTx) =>
    inWindow.has(monthOf(t.bookingDate)) && accounts.has(t.accountId) && netPurchase(t) > 0 && !NOT_A_HABIT.has(t.category) && !a.ctx.fixedIds.has(t.id);
  const rows = a.ctx.txs.filter((t) => t.merchant === merchant && counted(t));
  if (!rows.length) return null;
  // a month without a single row on the merchant's accounts is missing data, not a quiet month
  const own = new Set(rows.map((t) => t.accountId));
  const active = new Set(a.ctx.txs.filter((t) => own.has(t.accountId)).map((t) => monthOf(t.bookingDate)));
  if (!months.every((m) => active.has(m))) return null;

  const struck = new Set(levelWithoutOneOffs(rows, months).struck);
  const visits = rows.filter((t) => !struck.has(t.id));
  const own6 = rise(countsBy(visits, win.now), countsBy(visits, win.then));
  if (!own6) return null;
  // the same small purchases elsewhere: a move from one kiosk to the next is no rise
  const category = mainCategory(rows);
  const small = a.ctx.txs.filter((t) => t.category === category && counted(t) && netPurchase(t) < SMALL_CENTS && !struck.has(t.id));
  const all = rise(countsBy(small, win.now), countsBy(small, win.then));
  if (!all) return null;
  const more = Math.min(own6.now - own6.then, all.now - all.then);
  const recent = visits.filter((t) => win.now.includes(monthOf(t.bookingDate)));
  const ticket = Math.round(mean(recent.map(netPurchase)));
  const midCents = Math.round(more * ticket * 12);
  if (midCents < MIN_HABIT_YEARLY) return null;
  const thenMean = mean(countsBy(visits, win.then));
  const highCents = Math.max(midCents, Math.round((own6.now - thenMean) * ticket * 12));

  const weaknesses =
    recent.filter((t) => t.weekday < 5).length >= WEEKDAY_SHARE * recent.length ? [{ id: "estimate" as const, reason: "Osa voi olla työpäivän ostoksia." }] : [];
  const nowSpan = capitalise(monthSpan(win.now[0]!, win.now[win.now.length - 1]!));
  const thenSpan = capitalise(monthSpan(win.then[0]!, win.then[win.then.length - 1]!));
  const struckRows = rows.filter((t) => struck.has(t.id)).sort((x, y) => netPurchase(y) - netPurchase(x));
  const evidence = [...struckRows.slice(0, 10), ...visits.slice(-(MAX_ROWS - Math.min(10, struckRows.length)))];
  const calc: CalcLine[] = [
    { label: `${nowSpan}, kertaa kuussa tavallisesti`, value: formatCount(own6.now) },
    { label: `${thenSpan}, kertaa kuussa tavallisesti`, value: formatCount(own6.then) },
    { label: `${thenSpan}, kertaa kuussa keskimäärin`, value: formatCount(thenMean) },
    { label: "Ostoskerta keskimäärin", value: formatEur(ticket) },
    { label: "Ero vuodessa", value: eur(midCents) },
    ...struckRows.slice(0, 5).map((t) => ({ label: `Kertaosto ${formatFiDate(t.bookingDate)}`, value: formatEur(netPurchase(t)), struck: true })),
  ];
  if (more < own6.now - own6.then) calc.splice(3, 0, { label: "Pieniä ostoksia lisää kuussa, sama kategoria", value: formatCount(all.now - all.then) });
  return {
    id: findingId("habits", "repeat", merchant),
    area: "habits",
    kind: "repeat",
    subject: merchant,
    title: `${merchant}: ${formatCount(own6.now)} kertaa kuussa, vuotta aiemmin ${formatCount(own6.then)}. Ostoskerta keskimäärin ${formatEur(ticket)}, ${monthSpan(win.now[0]!, win.now[win.now.length - 1]!)} verrattuna samaan aikaan vuotta aiemmin.`,
    action: `Tarkista käyntien määrä: vuotta aiemmin ${formatCount(own6.then)} kertaa kuussa.`,
    euros: { lowCents: Math.round(midCents / 2), midCents, highCents },
    decideBy: null,
    weaknesses,
    shared: false,
    calc,
    rows: evidence.map((t) => t.id),
    struck: struckRows.slice(0, 10).map((t) => t.id),
    // a café habit is eating out too: it shares the claims so the headline counts that money once
    claims: FOOD.has(category) ? [...EATING_OUT_CLAIMS, `merchant:${merchant}`] : [`merchant:${merchant}`],
    measure: { kind: "merchants", keys: [merchant] },
    facts: [],
  };
}

export const habits: Area = {
  id: "habits",
  label: "Pienet tavat",
  assess: (a) => {
    const win = yearOverYear(a);
    const check = (status: Check["status"]): Check[] => [
      { id: "habits:repeat", label: "Arkiostot", status },
    ];
    if (!win) return { findings: [], checks: check("no_data") };
    const candidates = habitItems(a.ctx, { from: addDays(a.end, -(HABIT_DAYS - 1)), to: a.end }).map((h) => h.merchant).sort();
    const findings = candidates.map((m) => habitFinding(a, m, win)).filter((f): f is FindingDraft => f !== null);
    return { findings, checks: check("clear") };
  },
};
