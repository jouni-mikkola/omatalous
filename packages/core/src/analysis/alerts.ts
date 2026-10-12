import { getCategory } from "../categories.ts";
import { addDays, DAYS_PER_MONTH, dayNumber, daysBetween, monthIndex } from "../dates.ts";
import { fold, UNKNOWN_MERCHANT } from "../merchant.ts";
import type { RecurringSeries } from "../recurring.ts";
import { median } from "../stats.ts";
import { NO_INPUTS, type UserInputs } from "../types.ts";
import { categoryRises } from "./change.ts";
import { changeMonths, cutWords } from "./change-text.ts";
import { type AnalysisContext, type AnalysisTx, inDays, netPurchase, recurringAt } from "./context.ts";
import { isBankFee, isLateFee } from "./fees.ts";
import { finnishList, formatEur, formatFiDate, monthInessive } from "./format.ts";
import { type DateRange, rangeLength, toDayRange } from "./period.ts";
import { chargedAfterCancelling, dismissedIds, forgotten, marksBySubject } from "./subscription-alerts.ts";

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
  /** On a question about a forgotten service: the subject an answer is stored under, which names that one series. */
  markSubject?: string;
}

const MAX_ALERTS = 6;

/**
 * Cost traps in the selected period, judged at its end (range.to). Only
 * "forgotten" is about now, so it shows when the period reaches today.
 * Order: double_charge, late_fee, cancelled, overlap, spike, forgotten, fees, habit.
 * `inputs` carries the user's marks: a dismissed alert is left out, a subscription marked in use or cancelled is not
 * asked about, and a charge after a subscription was marked cancelled is a warning of its own.
 */
export function buildAlerts(ctx: AnalysisContext, range: DateRange, inputs: UserInputs = NO_INPUTS): Alert[] {
  const current = inDays(ctx, toDayRange(range));
  const recurring = recurringAt(ctx, range.to);
  const overlaps = overlapAlerts(recurring);
  const merchantMarks = marksBySubject(inputs.marks);
  return pick(
    [
      ...doubleCharges(ctx, current, recurring, range),
      ...lateFees(current),
      ...chargedAfterCancelling(current.filter(isCharge), merchantMarks, ctx.recurring),
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
    noun: "pilvitallennuspalvelua",
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

/** The rise in purchases lifts the category this far over its usual level, by at least this much, from at least this many purchases. */
const SPIKE_RATIO = 1.5;
const SPIKE_MIN_CENTS = 5000;
const SPIKE_MIN_PURCHASES = 3;
const MAX_SPIKES = 2;
const CHRISTMAS = new Set(["shopping", "home", "kids", "gifts_donations", "groceries", "alcohol"]);
const SUMMER = new Set(["travel", "entertainment"]);
/** Months (1–12) when a category is high every year in Finland: Christmas, the summer holiday. */
const SEASONAL = new Map<number, ReadonlySet<string>>([
  [12, CHRISTMAS],
  [6, SUMMER],
  [7, SUMMER],
  [8, SUMMER],
]);

/**
 * A spike is told from the usual view of the spending change (`categoryRises`, ADR 0013): the category, what it cost
 * and its usual level are the report's, and so are the month (`changeMonths`: the one the period ends in, the running
 * month for a period that reaches today), the base months, the one-offs, the gate and the noise test. The alert
 * decides the rest: how large a rise in purchases is worth a warning, and that a month which is high every year is
 * none.
 */
function spikes(ctx: AnalysisContext, range: DateRange): Alert[] {
  const { month } = changeMonths(ctx, range);
  const found = categoryRises(ctx, month);
  if (!found) return [];
  const season = SEASONAL.get(Number(month.slice(5, 7)));
  // the rows end before today (a sync that lags): the report cuts both figures at that day, and the alert names it
  const cutAt = cutWords(found.running, found.through, ctx.today);
  return found.rises
    .filter((r) => {
      // uncategorised rows are no category to act on, and a loan payment is no purchase
      if (r.category === "other" || getCategory(r.category).kind === "debt") return false;
      // a spike is more of the same: several purchases, most of what the category rose by, and beyond every usual
      // month (fuel swings from 60 € to 330 €; a new level is told in its first month and then by the report)
      if (r.purchases < SPIKE_MIN_PURCHASES || 2 * r.moreCents < r.changeCents || !r.peak) return false;
      // on its own it is worth a line in the report, 50 € and half as much again as usual
      if (r.moreCents < Math.max(SPIKE_MIN_CENTS, found.gateCents) || r.usualCents + r.moreCents <= SPIKE_RATIO * r.usualCents) return false;
      // the same month a year ago moved as far; without a year of history, Christmas presents and summer trips are still no surprise
      return !r.season && (r.yearAgoCents !== null || !season?.has(r.category));
    })
    .sort((a, b) => b.moreCents - a.moreCents || a.category.localeCompare(b.category))
    .slice(0, MAX_SPIKES)
    .map((r) => {
      const usual = r.usualCents >= 100 ? `noin ${formatEur(roundTo(r.usualCents, 100), false)}` : "ei lainkaan";
      return {
        id: `spike:${r.category}:${month}`,
        kind: "spike" as const,
        tone: "warning" as const,
        title: `${r.label} ${formatEur(r.nowCents, false)} ${cutAt ?? monthInessive(month)}`,
        // a running month is set against the same days of its usual months, as the report sets it
        detail: cutAt ? `Tavallisesti siihen mennessä ${usual}` : found.running ? `Tavallisesti tähän mennessä ${usual}` : `Tavallisesti ${usual}${r.usualCents >= 100 ? "/kk" : ""}`,
        category: r.category,
      };
    });
}

// ── bank fees ────────────────────────────────────────────

const FEES_MIN_YEARLY = 10000;
const FEES_MIN_MONTHS = 6;
const FEES_MIN_DAYS = 150;

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
  const months = days / DAYS_PER_MONTH;

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

