import { getCategory } from "../categories.ts";
import { addDays, dayNumber, daysBetween, daysInMonth, fromMonthIndex, monthIndex } from "../dates.ts";
import { fold, UNKNOWN_MERCHANT } from "../merchant.ts";
import type { RecurringSeries } from "../recurring.ts";
import { median } from "../stats.ts";
import { NO_INPUTS, type UserInputs } from "../types.ts";
import { type AnalysisContext, type AnalysisTx, historyCovers, inDays, netPurchase, recurringAt } from "./context.ts";
import { finnishList, formatEur, formatFiDate, monthInessive } from "./format.ts";
import { type DateRange, rangeLength, toDayRange } from "./period.ts";
import { chargedAfterCancelling, dismissedIds, forgotten, marksByMerchant } from "./subscription-alerts.ts";

export { inUseQuietsQuestion } from "./subscription-alerts.ts";

export type AlertKind = "double_charge" | "late_fee" | "cancelled" | "overlap" | "spike" | "fees" | "habit" | "forgotten";

/** A cost trap or a mistake worth acting on. The overview shows these before insights. */
export interface Alert {
  /** Stable for the same data, e.g. "double:<txId>". */
  id: string;
  kind: AlertKind;
  tone: "warning" | "info";
  title: string;
  detail: string;
  /** Where a click should go: a merchant or a category in the transactions list. */
  merchant?: string;
  category?: string;
}

const MAX_ALERTS = 6;

/**
 * Cost traps in the selected period, judged at its end (range.to). Only
 * "forgotten" is about now, so it shows when the period reaches today.
 * Order: double_charge, late_fee, cancelled, overlap, spike, forgotten, fees, habit.
 * `inputs` carries the user's marks: a dismissed alert is left out, a subscription marked in use or cancelled is not
 * asked about, and a charge after a merchant was marked cancelled is a warning of its own.
 */
export function buildAlerts(ctx: AnalysisContext, range: DateRange, inputs: UserInputs = NO_INPUTS): Alert[] {
  const current = inDays(ctx, toDayRange(range));
  const recurring = recurringAt(ctx, range.to);
  const overlaps = overlapAlerts(recurring);
  const merchantMarks = marksByMerchant(inputs.marks);
  return pick(
    [
      ...doubleCharges(ctx, current, recurring, range),
      ...lateFees(current),
      ...chargedAfterCancelling(current.filter(isCharge), merchantMarks),
      ...overlaps.alerts,
      ...spikes(ctx, range),
      ...(range.to >= ctx.today ? forgotten(ctx.recurring, overlaps.merchants, merchantMarks, ctx.today) : []),
      ...bankFees(ctx, current, range),
      ...habits(ctx, range),
    ],
    dismissedIds(inputs.marks),
  );
}

/** One of each kind first, then the rest in order, so a long list of one kind cannot hide the others. Dismissed ids are left out first. */
function pick(shown: readonly Alert[], dismissed: ReadonlySet<string>): Alert[] {
  const all = shown.filter((a) => !dismissed.has(a.id));
  const chosen = new Set<Alert>();
  const kinds = new Set<AlertKind>();
  for (const a of all) {
    if (chosen.size < MAX_ALERTS && !kinds.has(a.kind)) {
      kinds.add(a.kind);
      chosen.add(a);
    }
  }
  for (const a of all) if (chosen.size < MAX_ALERTS) chosen.add(a);
  return all.filter((a) => chosen.has(a));
}

const isCharge = (t: AnalysisTx) =>
  t.status === "booked" && !t.isTransfer && t.amountCents < 0 && t.kind !== "transfer" && t.merchant !== UNKNOWN_MERCHANT;

// ── double charges ───────────────────────────────────────

const DOUBLE_MIN_CENTS = 2000;
const BILL_DOUBLE_DAYS = 7;

/**
 * Identical charges on one account and day, and how often each merchant does it.
 * Over the whole history and independent of the range, so the dashboard's
 * several periods share one scan.
 */
const sameDayCache = new WeakMap<AnalysisContext, { groups: AnalysisTx[][]; routine: Map<string, number> }>();

function sameDayCharges(ctx: AnalysisContext) {
  const hit = sameDayCache.get(ctx);
  if (hit) return hit;
  const sameDay = new Map<string, AnalysisTx[]>();
  for (const t of ctx.txs) {
    if (!isCharge(t)) continue;
    const key = `${t.accountId}|${t.merchant}|${t.amountCents}|${t.bookingDate}`;
    const group = sameDay.get(key);
    if (group) group.push(t);
    else sameDay.set(key, [t]);
  }
  // two tickets at the cinema every time: a merchant that does this routinely is not a mistake
  const groups: AnalysisTx[][] = [];
  const routine = new Map<string, number>();
  for (const group of sameDay.values()) {
    if (group.length < 2) continue;
    groups.push(group);
    const key = `${group[0]!.accountId}|${group[0]!.merchant}`;
    routine.set(key, (routine.get(key) ?? 0) + 1);
  }
  const result = { groups, routine };
  sameDayCache.set(ctx, result);
  return result;
}

function doubleCharges(ctx: AnalysisContext, current: readonly AnalysisTx[], recurring: readonly RecurringSeries[], range: DateRange): Alert[] {
  const { fromDay, toDay } = toDayRange(range);
  const { groups, routine } = sameDayCharges(ctx);

  const out: (Alert & { date: string })[] = [];
  for (const group of groups) {
    const t = group[group.length - 1]!;
    if (group.length < 2 || t.day < fromDay || t.day > toDay || -t.amountCents < DOUBLE_MIN_CENTS) continue;
    // the merchant has already paid one of them back
    if (group.some((x) => x.refunded >= -x.amountCents)) continue;
    if ((routine.get(`${t.accountId}|${t.merchant}`) ?? 0) - 1 >= 2) continue;
    out.push({
      id: `double:${t.id}`,
      kind: "double_charge",
      tone: "warning",
      title: `Sama veloitus ${group.length === 2 ? "kahdesti" : `${group.length} kertaa`}: ${t.merchant} ${formatEur(-t.amountCents)}`,
      detail: formatFiDate(t.bookingDate),
      merchant: t.merchant,
      date: t.bookingDate,
    });
  }

  // a monthly bill paid twice a few days apart (an e-invoice and a reminder of it)
  const inRange = new Map(current.map((t) => [t.id, t]));
  const byId = new Map<string, AnalysisTx>();
  for (const s of recurring) {
    if (s.cadence !== "monthly" || (s.kind !== "subscription" && s.kind !== "bill")) continue;
    if (!s.transactionIds.some((id) => inRange.has(id))) continue;
    if (!byId.size) for (const t of ctx.txs) byId.set(t.id, t);
    const rows = s.transactionIds
      .map((id) => byId.get(id))
      .filter((t): t is AnalysisTx => !!t && isCharge(t))
      .sort((a, b) => a.day - b.day);
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1]!, rows[i]!];
      const gap = b.day - a.day;
      if (gap < 1 || gap > BILL_DOUBLE_DAYS || a.amountCents !== b.amountCents || -b.amountCents < DOUBLE_MIN_CENTS || !inRange.has(b.id)) continue;
      out.push({
        id: `double:${b.id}`,
        kind: "double_charge",
        tone: "warning",
        title: `Sama veloitus kahdesti: ${b.merchant} ${formatEur(-b.amountCents)}`,
        detail: `${formatFiDate(a.bookingDate)} ja ${formatFiDate(b.bookingDate)}`,
        merchant: b.merchant,
        date: b.bookingDate,
      });
    }
  }
  // the latest first
  return out
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3)
    .map(({ date: _date, ...a }) => a);
}

// ── late payment fees ────────────────────────────────────

const LATE_FEE = /MUISTUTUSMAKSU|VIIVASTYSKORKO|PERINTAKULU|KARHUMAKSU|MAKSUMUISTUTUS/;

/** A reminder fee or late interest: its own alert, and not a bank's price. Optimoi's late fee finding reads the same rows. */
export const isLateFee = (t: AnalysisTx) => t.amountCents < 0 && !t.isTransfer && LATE_FEE.test(fold(`${t.description ?? ""} ${t.counterparty ?? ""} ${t.merchant}`));

const LATE_FEE_WORDS = new RegExp(LATE_FEE.source, "g");

/**
 * A late fee whose message names nothing but the fee. "LASKU 4471 JA PERINTAKULU" pays the bill too, so its sum is not
 * the fee's; the alert counts it, a figure of what the fees cost does not.
 */
export const isLateFeeAlone = (t: AnalysisTx) => isLateFee(t) && !/[A-Z0-9]/.test(fold(t.description ?? "").replace(LATE_FEE_WORDS, ""));

function lateFees(current: readonly AnalysisTx[]): Alert[] {
  const rows = current.filter(isLateFee);
  if (!rows.length) return [];
  const total = rows.reduce((s, t) => s - t.amountCents, 0);
  const merchants = [...new Set(rows.map((t) => t.merchant))];
  const dates = [...new Set(rows.map((t) => t.bookingDate))].sort();
  const when = dates.length === 1 ? formatFiDate(dates[0]!) : dates.length === 2 ? finnishList(dates.map(formatFiDate)) : `viimeksi ${formatFiDate(dates[dates.length - 1]!)}`;
  return [
    {
      id: `late:${rows[rows.length - 1]!.id}`,
      kind: "late_fee",
      tone: "warning",
      title: `Myöhästymiskuluja ${formatEur(total)}`,
      detail: `${finnishList(merchants)}, ${when}`,
      ...(merchants.length === 1 ? { merchant: merchants[0] } : {}),
    },
  ];
}

// ── overlapping services ─────────────────────────────────

export type ServiceType = "audiobooks" | "music" | "cloud" | "video";

/** Substitutes first: two audiobook services is plainly one too many, several video services is common. */
const SERVICES: readonly { type: ServiceType; noun: string; brands: readonly [string, RegExp][] }[] = [
  {
    type: "audiobooks",
    noun: "äänikirjapalvelua",
    brands: [
      ["storytel", /STORYTEL/],
      ["bookbeat", /BOOKBEAT/],
      ["nextory", /NEXTORY/],
      ["elisakirja", /ELISA ?KIRJA/],
      ["audible", /AUDIBLE/],
    ],
  },
  {
    type: "music",
    noun: "musiikkipalvelua",
    brands: [
      ["spotify", /SPOTIFY/],
      ["applemusic", /APPLE ?MUSIC/],
      ["tidal", /TIDAL/],
      ["deezer", /DEEZER/],
      ["youtube", /YOUTUBE/],
    ],
  },
  {
    type: "cloud",
    noun: "pilvitallennusta",
    brands: [
      ["icloud", /ICLOUD/],
      ["googleone", /GOOGLE ?ONE/],
      ["dropbox", /DROPBOX/],
      ["onedrive", /ONEDRIVE|MICROSOFT ?365|OFFICE ?365/],
    ],
  },
  {
    type: "video",
    noun: "videopalvelua",
    brands: [
      ["netflix", /NETFLIX/],
      ["max", /HBO|^MAX(\.COM)?$/],
      ["disney", /DISNEY/],
      ["viaplay", /VIAPLAY/],
      ["katsomo", /KATSOMO|^MTV\b/],
      ["skyshowtime", /SKY ?SHOWTIME/],
      ["ruutu", /RUUTU/],
      ["prime", /PRIME ?VIDEO|AMAZON ?PRIME/],
      ["appletv", /APPLE ?TV/],
    ],
  },
];

const COUNT_WORD = ["", "Yksi", "Kaksi", "Kolme", "Neljä", "Viisi", "Kuusi", "Seitsemän", "Kahdeksan", "Yhdeksän"];

/** Services of one type from two or more brands, dearest series first. */
export interface OverlapGroup {
  type: ServiceType;
  /** Partitive, after a count word: "musiikkipalvelua". */
  noun: string;
  matched: { s: RecurringSeries; brand: string }[];
  /** Brands among `matched`, at least two. */
  distinct: number;
}

/**
 * Active expense series that substitute for each other, per service type, in the order of `SERVICES`. The overlap
 * alert and Optimoi's overlap finding read this, so both pages name the same services.
 */
export function overlapGroups(recurring: readonly RecurringSeries[]): OverlapGroup[] {
  const subs = recurring.filter((s) => s.active && (s.kind === "subscription" || s.kind === "bill") && getCategory(s.category).kind === "expense");
  const out: OverlapGroup[] = [];
  for (const { type, noun, brands } of SERVICES) {
    const matched = subs
      .map((s) => ({ s, brand: brands.find(([, re]) => re.test(fold(s.merchant)))?.[0] }))
      .filter((m): m is { s: RecurringSeries; brand: string } => !!m.brand)
      .sort((a, b) => b.s.monthlyCents - a.s.monthlyCents);
    const distinct = new Set(matched.map((m) => m.brand)).size;
    if (distinct >= 2) out.push({ type, noun, matched, distinct });
  }
  return out;
}

function overlapAlerts(recurring: readonly RecurringSeries[]): { alerts: Alert[]; merchants: Set<string> } {
  const alerts: Alert[] = [];
  const merchants = new Set<string>();
  for (const { type, noun, matched, distinct } of overlapGroups(recurring)) {
    const names = [...new Set(matched.map((m) => m.s.merchant))];
    const monthly = matched.reduce((sum, m) => sum + m.s.monthlyCents, 0);
    const categories = new Set(matched.map((m) => m.s.category));
    for (const n of names) merchants.add(n);
    alerts.push({
      id: `overlap:${type}`,
      kind: "overlap",
      tone: type === "video" ? "info" : "warning",
      title: `${COUNT_WORD[distinct] ?? distinct} ${noun}`,
      detail: `${finnishList(names)}, yhteensä ${formatEur(monthly)}/kk`,
      ...(categories.size === 1 ? { category: [...categories][0] } : {}),
    });
  }
  return { alerts, merchants };
}

// ── spending spikes ──────────────────────────────────────

const SPIKE_RATIO = 1.5;
const SPIKE_MIN_CENTS = 5000;
const SPIKE_MIN_TXS = 3;
const SPIKE_BASE_MONTHS = 6;
const CHRISTMAS = new Set(["shopping", "home", "kids", "gifts_donations", "groceries", "alcohol"]);
const SUMMER = new Set(["travel", "entertainment"]);
/** Months (1–12) when a category is high every year in Finland: Christmas, the summer holiday. */
const SEASONAL = new Map<number, ReadonlySet<string>>([
  [12, CHRISTMAS],
  [6, SUMMER],
  [7, SUMMER],
  [8, SUMMER],
]);

/** The selected month, or the range's last complete month. */
function spikeMonth(ctx: AnalysisContext, range: DateRange): number | null {
  const first = monthIndex(range.from);
  const last = monthIndex(range.to);
  if (first === last) return last;
  for (let m = last; m >= first; m--) {
    const label = fromMonthIndex(m);
    const end = `${label}-${String(daysInMonth(label)).padStart(2, "0")}`;
    if (`${label}-01` >= range.from && end <= range.to && end < ctx.today) return m;
  }
  return null;
}

function spikes(ctx: AnalysisContext, range: DateRange): Alert[] {
  const target = spikeMonth(ctx, range);
  if (target === null) return [];
  const base: number[] = [];
  for (let m = target - SPIKE_BASE_MONTHS; m < target; m++) if (historyCovers(ctx, `${fromMonthIndex(m)}-01`)) base.push(m);
  if (base.length < 3) return [];
  const lastYear = target - 12;
  const lastYearCovered = historyCovers(ctx, `${fromMonthIndex(lastYear)}-01`);
  const { fromDay, toDay } = toDayRange(range);

  const per = new Map<string, { now: number; count: number; largest: number; fixed: number; months: Map<number, number> }>();
  for (const t of ctx.txs) {
    if (!t.spend || t.category === "other") continue;
    const inTarget = t.month === target && t.day >= fromDay && t.day <= toDay;
    if (!inTarget && t.month !== lastYear && (t.month < base[0]! || t.month >= target)) continue;
    const e = per.get(t.category) ?? { now: 0, count: 0, largest: 0, fixed: 0, months: new Map<number, number>() };
    if (inTarget) {
      e.now += t.spend;
      e.count += 1;
      e.largest = Math.max(e.largest, t.spend);
      if (ctx.fixedIds.has(t.id)) e.fixed += t.spend;
    } else if (t.month !== target) {
      e.months.set(t.month, (e.months.get(t.month) ?? 0) + t.spend);
    }
    per.set(t.category, e);
  }

  const out: (Alert & { diff: number })[] = [];
  const season = SEASONAL.get(Number(fromMonthIndex(target).slice(5, 7)));
  for (const [category, e] of per) {
    const baseValues = base.map((m) => e.months.get(m) ?? 0);
    const typical = median(baseValues);
    if (e.count < SPIKE_MIN_TXS || e.now <= SPIKE_RATIO * typical || e.now - typical < SPIKE_MIN_CENTS) continue;
    // bills paid late or early land two in one month: the late fee alert covers that
    if (e.fixed >= 0.8 * e.now) continue;
    // a spike is more of the same, not one big purchase (a doctor's visit, a sofa, a car repair): it
    // must hold without the largest, and beyond every month before (fuel swings from 60 € to 330 €)
    const rest = e.now - e.largest;
    if (rest <= SPIKE_RATIO * typical || rest - typical < SPIKE_MIN_CENTS || rest <= Math.max(...baseValues)) continue;
    // the same month a year ago was as high: Christmas or a season fee, not a surprise
    if (lastYearCovered && (e.months.get(lastYear) ?? 0) >= 0.8 * e.now) continue;
    // without a year of history, Christmas presents and summer trips are still no surprise
    if (!lastYearCovered && season?.has(category)) continue;
    const label = getCategory(category).label;
    out.push({
      id: `spike:${category}:${fromMonthIndex(target)}`,
      kind: "spike",
      tone: "warning",
      title: `${label} ${formatEur(e.now, false)} ${monthInessive(fromMonthIndex(target))}`,
      detail: typical >= 100 ? `Tavallisesti noin ${formatEur(roundTo(typical, 100), false)}/kk` : "Tavallisesti ei lainkaan",
      category,
      diff: e.now - typical,
    });
  }
  return out
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 2)
    .map(({ diff: _diff, ...a }) => a);
}

// ── bank fees ────────────────────────────────────────────

const FEES_MIN_YEARLY = 10000;
const FEES_MIN_MONTHS = 6;
const FEES_MIN_DAYS = 150;

/** A bank's own price or interest, late fees left out: the rows of the bank fees alert and of Optimoi's bank fee summary. */
export const isBankFee = (t: AnalysisTx) => (t.category === "fees" || t.category === "interest") && t.spend > 0 && !isLateFee(t);

function bankFees(ctx: AnalysisContext, current: readonly AnalysisTx[], range: DateRange): Alert[] {
  if (monthIndex(range.to) - monthIndex(range.from) + 1 < FEES_MIN_MONTHS || !ctx.dataFrom) return [];
  const from = ctx.dataFrom > range.from ? ctx.dataFrom : range.from;
  const to = ctx.today < range.to ? ctx.today : range.to;
  const days = daysBetween(from, to) + 1;
  if (days < FEES_MIN_DAYS) return [];
  const byMerchant = new Map<string, number>();
  for (const t of current) {
    if (!isBankFee(t)) continue;
    byMerchant.set(t.merchant, (byMerchant.get(t.merchant) ?? 0) + t.spend);
  }
  const total = [...byMerchant.values()].reduce((s, v) => s + v, 0);
  const yearly = (total * 365) / days;
  if (yearly <= FEES_MIN_YEARLY) return [];
  const top = [...byMerchant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([m]) => m);
  return [
    {
      id: `fees:${range.from}:${range.to}`,
      kind: "fees",
      tone: "info",
      title: `Pankkikuluja ${formatEur(roundTo(yearly, 100), false)} vuodessa`,
      detail: finnishList(top),
      category: "fees",
    },
  ];
}

// ── small frequent purchases ─────────────────────────────

const HABIT_MIN_PER_MONTH = 8;
const HABIT_MAX_MEDIAN = 1000;
const HABIT_WINDOW_DAYS = 90;
const HABIT_MIN_DAYS = 45;
const NOT_A_HABIT = new Set(["p2p", "cash"]);

/** A merchant bought from often in small sums (the habit alert), with what it costs. */
export interface HabitItem {
  merchant: string;
  /** Purchases a month over the window, rounded: the title shows a whole number. */
  perMonth: number;
  /** Cents a year at the window's pace, rounded to 10 €. */
  yearly: number;
}

/**
 * Merchants bought from at least 8 times a month with a median under 10 € over the last 90 days of `range` (or the
 * whole range when it is longer): fixed costs, cash, payments to people and unknown payees are left out. The habit
 * alert shows the two largest; Optimoi reads every one.
 */
export function habitItems(ctx: AnalysisContext, range: DateRange): HabitItem[] {
  if (!ctx.dataFrom) return [];
  let from = rangeLength(range) >= HABIT_WINDOW_DAYS ? range.from : addDays(range.to, -(HABIT_WINDOW_DAYS - 1));
  if (ctx.dataFrom > from) from = ctx.dataFrom;
  const to = ctx.today < range.to ? ctx.today : range.to;
  const days = daysBetween(from, to) + 1;
  if (days < HABIT_MIN_DAYS) return [];
  const months = days / 30.44;

  const byMerchant = new Map<string, number[]>();
  for (const t of inDays(ctx, { fromDay: dayNumber(from), toDay: dayNumber(to) })) {
    if (netPurchase(t) <= 0 || t.merchant === UNKNOWN_MERCHANT || NOT_A_HABIT.has(t.category) || ctx.fixedIds.has(t.id)) continue;
    const amounts = byMerchant.get(t.merchant);
    if (amounts) amounts.push(netPurchase(t));
    else byMerchant.set(t.merchant, [netPurchase(t)]);
  }
  const out: HabitItem[] = [];
  for (const [merchant, amounts] of byMerchant) {
    // the title shows a whole number, so 7,7 a month reads and counts as 8
    const perMonth = Math.round(amounts.length / months);
    if (perMonth < HABIT_MIN_PER_MONTH || median(amounts) >= HABIT_MAX_MEDIAN) continue;
    out.push({ merchant, perMonth, yearly: roundTo((amounts.reduce((s, v) => s + v, 0) / months) * 12, 1000) });
  }
  return out;
}

function habits(ctx: AnalysisContext, range: DateRange): Alert[] {
  return habitItems(ctx, range)
    .map(({ merchant, perMonth, yearly }) => ({
      id: `habit:${merchant}`,
      kind: "habit" as const,
      tone: "info" as const,
      title: `${merchant} ${perMonth} kertaa kuussa`,
      detail: `Noin ${formatEur(yearly, false)} vuodessa`,
      merchant,
      yearly,
    }))
    .sort((a, b) => b.yearly - a.yearly)
    .slice(0, 2)
    .map(({ yearly: _yearly, ...a }) => a);
}

const roundTo = (cents: number, step: number) => Math.round(cents / step) * step;

