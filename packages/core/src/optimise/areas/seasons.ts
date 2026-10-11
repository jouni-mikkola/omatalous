/**
 * Vuosimenot: calendar months that cost clearly more than usual in each of the last two years (F 3.13). The months come
 * from `expensiveMonthItems`, the seasons insight's own detector, judged on today as the overview does, so both pages
 * name the same months and the same excess. Optimoi asks one thing more: the same category caused most of the excess in
 * both years, so two random dear months a year apart are no season. When the household paid more interest in the two
 * months after such a month than in the two before it, in both years, that interest is the yearly price. Otherwise the
 * month is a deadline when it starts within 60 days: a monthly reserve, with no euros claimed.
 */
import type { AnalysisContext, AnalysisTx } from "../../analysis/context.ts";
import { formatEur, formatFiDate, monthInessive } from "../../analysis/format.ts";
import { expensiveMonthItems, type Season } from "../../analysis/insights/seasons.ts";
import { capitalise, gateMonthly, lastCompleteMonths, monthName, monthRows, monthStem, oneOff, shiftMonth } from "../../analysis/insights/shared.ts";
import { completeMonthsBefore, isCompleteMonth, usualSpending } from "../../analysis/usual.ts";
import { getCategory } from "../../categories.ts";
import { daysBetween } from "../../dates.ts";
import { median } from "../../stats.ts";
import { findingId, GATE_YEARLY_CENTS, netCost } from "../common.ts";
import type { Area, AreaInput, CalcLine, Check, FindingDraft } from "../types.ts";

const SOON_DAYS = 60;
/** The biggest rows of each year's month shown as evidence. */
const ROWS_PER_YEAR = 25;
/** The category behind a season must carry at least this share of each year's excess. */
const DRIVER_SHARE = 1 / 3;

const eur = (cents: number) => formatEur(cents, false);
/** "tammi–helmikuussa" for the two months from `month`. */
const twoMonthsInessive = (month: string) => `${monthStem(month)}–${monthInessive(shiftMonth(month, 1))}`;
/** "joulukuun" */
const monthGenitive = (month: string) => `${monthName(month)}n`;

interface CreditCost {
  /** Interest in the two months after less the interest in the two months before, cents. */
  extra: number;
  after: number;
  before: number;
  drawn: number;
  rows: AnalysisTx[];
}

/** Interest and credit drawn around one year's expensive month, or null when a month around it is not complete. */
function creditAround(ctx: AnalysisContext, month: string): CreditCost | null {
  const after = [shiftMonth(month, 1), shiftMonth(month, 2)];
  const before = [shiftMonth(month, -2), shiftMonth(month, -1)];
  if (![...after, ...before].every((m) => isCompleteMonth(ctx, m))) return null;
  const sum = (months: readonly string[], pick: (t: AnalysisTx) => number) => months.reduce((s, m) => s + monthRows(ctx, m).txs.reduce((x, t) => x + pick(t), 0), 0);
  const interest = (t: AnalysisTx) => (t.category === "interest" ? netCost(t) : 0);
  const a = sum(after, interest);
  const b = sum(before, interest);
  const rows = after.flatMap((m) => monthRows(ctx, m).txs.filter((t) => (t.category === "interest" && netCost(t) > 0) || t.flows.borrowed > 0));
  return { extra: a - b, after: a, before: b, drawn: sum(after, (t) => t.flows.borrowed), rows };
}

/** The month's biggest purchases and its one-off, the evidence of an expensive month. */
function monthEvidence(ctx: AnalysisContext, month: string): { rows: AnalysisTx[]; one: AnalysisTx | null } {
  const usual = usualSpending(ctx, month);
  const one = usual === null ? null : oneOff(ctx, month, monthRows(ctx, month).spend - usual);
  const rows = monthRows(ctx, month)
    .txs.filter((t) => netCost(t) > 0 && t.category !== "card_bill" && !ctx.fixedIds.has(t.id) && t.id !== one?.id)
    .sort((x, y) => netCost(y) - netCost(x) || x.id.localeCompare(y.id))
    .slice(0, ROWS_PER_YEAR - (one ? 1 : 0));
  return { rows: one ? [one, ...rows] : rows, one };
}

/** The category whose spending rose most over its own usual level (the median of the six months before) in the month. */
function driverOf(ctx: AnalysisContext, month: string, one: AnalysisTx | null): { category: string; excess: number } | null {
  const sums = (m: string) => {
    const out = new Map<string, number>();
    for (const t of monthRows(ctx, m).txs) {
      if (t.id === one?.id || t.category === "card_bill" || ctx.fixedIds.has(t.id) || netCost(t) <= 0) continue;
      out.set(t.category, (out.get(t.category) ?? 0) + netCost(t));
    }
    return out;
  };
  const past = completeMonthsBefore(ctx, month).map(sums);
  let best: { category: string; excess: number } | null = null;
  for (const [category, cents] of [...sums(month)].sort((x, y) => x[0].localeCompare(y[0]))) {
    const excess = cents - median(past.map((p) => p.get(category) ?? 0));
    if (!best || excess > best.excess) best = { category, excess };
  }
  return best;
}

function seasonFinding(a: AreaInput, s: Season): FindingDraft | null {
  const { ctx, today } = a;
  const mm = s.month.slice(5);
  const years = [s.month, shiftMonth(s.month, -12)];
  const name = capitalise(monthName(s.month));
  const reserve = Math.ceil(s.extra / 1200) * 100;
  const evidence = years.map((m) => monthEvidence(ctx, m));
  // a season is the same purchases coming back: two dear months a year apart for different reasons are chance,
  // uncategorised rows cannot tell that they were the same, and two loan payments in one month are no purchases
  const drivers = years.map((m, i) => driverOf(ctx, m, evidence[i]!.one));
  const driver = drivers[0]?.category;
  if (!driver || driver === "other" || getCategory(driver).kind !== "expense") return null;
  if (drivers.some((d, i) => d?.category !== driver || d.excess < DRIVER_SHARE * s.extras[i]!)) return null;
  const struck = evidence.flatMap((e) => (e.one ? [e.one] : []));
  const calc: CalcLine[] = [
    ...years.map((m, i) => ({ label: `${capitalise(monthName(m))} ${m.slice(0, 4)}, yli tavallisen`, value: eur(s.extras[i]!) })),
    { label: "Keskimäärin yli tavallisen", value: eur(s.extra) },
    { label: "Suurin lisä molempina vuosina", value: getCategory(driver).label },
    ...struck.map((t) => ({ label: `Kertaosto ${t.merchant} ${formatFiDate(t.bookingDate)}`, value: formatEur(netCost(t)), struck: true })),
  ];
  const base = {
    id: findingId("seasons", "month", mm),
    area: "seasons" as const,
    kind: "month",
    subject: mm,
    weaknesses: [],
    shared: false,
    struck: struck.map((t) => t.id),
    facts: [],
  };

  const credit = years.map((m) => creditAround(ctx, m));
  if (credit.every((c) => c !== null && c.extra > 0)) {
    const extras = credit.map((c) => c!.extra);
    const midCents = Math.round((extras[0]! + extras[1]!) / 2);
    if (midCents >= GATE_YEARLY_CENTS) {
      const creditCalc: CalcLine[] = years.flatMap((m, i) => {
        const c = credit[i]!;
        const after = shiftMonth(m, 1);
        const lines: CalcLine[] = [
          { label: `Korko ${twoMonthsInessive(after)} ${shiftMonth(m, 2).slice(0, 4)}`, value: eur(c.after) },
          { label: `Korko ${twoMonthsInessive(shiftMonth(m, -2))} ${shiftMonth(m, -1).slice(0, 4)}`, value: eur(c.before) },
        ];
        if (c.drawn > 0) lines.push({ label: `Luottoa nostettu ${twoMonthsInessive(after)} ${shiftMonth(m, 2).slice(0, 4)}`, value: eur(c.drawn) });
        return lines;
      });
      return {
        ...base,
        title: `${name} on ollut kahtena vuonna ${eur(s.extra)} tavallista kalliimpi. ${capitalise(twoMonthsInessive(shiftMonth(s.month, 1)))} korkoa maksettiin keskimäärin ${eur(midCents)} enemmän kuin ${twoMonthsInessive(shiftMonth(s.month, -2))}.`,
        action: `Maksa ${monthGenitive(s.month)} menot ilman luottoa: varaa ${eur(reserve)} kuussa.`,
        effort: "tunti",
        euros: { lowCents: Math.min(...extras), midCents, highCents: Math.max(...extras), assumption: `Jos ${monthGenitive(s.month)} lisämenot maksetaan ilman luottoa.` },
        decideBy: null,
        calc: [
          ...calc,
          ...creditCalc,
          { label: "Korkoa enemmän, keskimäärin", value: eur(midCents) },
          { label: "Varaus kuussa", value: eur(reserve) },
        ],
        rows: [...evidence.flatMap((e) => e.rows), ...credit.flatMap((c) => c!.rows.slice(0, 5))].map((t) => t.id),
        claims: ["category:interest"],
        measure: { kind: "category", keys: ["interest"] },
      };
    }
  }

  // the next start of the month: a deadline only while it is still ahead and near
  const year = Number(today.slice(0, 4));
  const start = [`${year}-${mm}-01`, `${year + 1}-${mm}-01`].find((d) => d > today)!;
  if (daysBetween(today, start) > SOON_DAYS) return null;
  return {
    ...base,
    title: `${name} on ollut kahtena vuonna ${eur(s.extra)} tavallista kalliimpi. ${capitalise(monthInessive(s.month))} ${s.month.slice(0, 4)} lisämenot olivat ${eur(s.extras[0]!)} ja vuotta aiemmin ${eur(s.extras[1]!)}, kertaostot pois lukien.`,
    action: `Varaa ${monthGenitive(s.month)} menoihin ${eur(reserve)} kuussa.`,
    effort: "minuutteja",
    euros: null,
    decideBy: start,
    calc: [...calc, { label: "Varaus kuussa", value: eur(reserve) }],
    rows: evidence.flatMap((e) => e.rows).map((t) => t.id),
    claims: [],
    measure: { kind: "none", keys: [] },
  };
}

export const seasons: Area = {
  id: "seasons",
  label: "Vuosimenot",
  assess: (a) => {
    const recent = lastCompleteMonths(a.ctx, a.today, 12);
    const enough = recent.length === 12 && isCompleteMonth(a.ctx, shiftMonth(recent[0]!, -12));
    const checks: Check[] = [
      { id: "seasons:month", label: "Kalliit kuukaudet", status: enough ? "clear" : "no_data", ...(enough ? {} : { hint: "Vertailu tarvitsee kahden vuoden historian." }) },
    ];
    if (!enough) return { findings: [], checks };
    const items = expensiveMonthItems({ ctx: a.ctx, end: a.today, gateMonthlyCents: gateMonthly(a.ctx, a.today) });
    const findings = items.map((s) => seasonFinding(a, s)).filter((f): f is FindingDraft => f !== null);
    return { findings, checks };
  },
};
