// Decision: is our income changing, and does the buffer match how it moves
import type { AnalysisContext } from "../analysis/context.ts";
import { INCOME_GROUPS, INCOME_TYPE_ORDER, INCOME_TYPES, type IncomeGroup, type IncomeType, nextPayDate } from "../analysis/income.ts";
import { benefitName, type IncomeBase, incomeBase, type IncomeChange, incomeChanges, payDayText } from "../analysis/income-changes.ts";
import type { DateRange } from "../analysis/period.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { addDays, addMonths, dayNumber, monthOf } from "../dates.ts";
import { fold } from "../merchant.ts";
import { median } from "../stats.ts";
import type { BalanceInput, IsoDate } from "../types.ts";

export interface IncomeRowRef {
  id: string;
  date: IsoDate;
  amountCents: number;
}

export interface IncomePayerRow {
  payer: string;
  totalCents: number;
  payments: number;
  /** Median payment. */
  usualCents: number;
  lastDate: IsoDate;
  /** The next pay day of a regular payer that is still paying, null otherwise. */
  nextDate: IsoDate | null;
  rows: IncomeRowRef[];
}

export interface IncomeTypeRow {
  type: IncomeType;
  label: string;
  group: IncomeGroup;
  regular: boolean;
  earned: boolean;
  totalCents: number;
  /** Over the complete months of the window, null without one. */
  monthlyCents: number | null;
  /** Share of earned income, null for money that is not earned. */
  share: number | null;
  payers: IncomePayerRow[];
}

export interface IncomeMonth {
  month: string;
  complete: boolean;
  totalCents: number;
  byGroup: Record<IncomeGroup, number>;
}

export interface IncomeStability {
  /** Median of the regular income of the twelve months. */
  medianCents: number;
  /** Median month-to-month change over the median. */
  spread: number;
  lowCents: number;
  lowMonth: string;
  /** How far the lowest month is below the median, as a share of it. */
  lowShare: number;
  /** The largest sum of shortfalls under the median in months in a row, and that in weeks of usual income. */
  worstRunCents: number;
  worstRunWeeks: number;
}

export interface IncomePayDay {
  label: string;
  payer: string;
  text: string;
  nextDate: IsoDate | null;
  usualCents: number;
}

export interface IncomeMember {
  label: string;
  earnedCents: number;
  /** A salary, benefit or pension series shows on the member's accounts. */
  regular: boolean;
}

export interface IncomeReport {
  /** The twelve months the figures cover, ending with the last complete month of the range. */
  months: IncomeMonth[];
  completeMonths: number;
  /** At least three complete months: the composition can be told. */
  enough: boolean;
  earnedCents: number;
  notEarnedCents: number;
  /** Earned income of the twelve months before, when the history covers them all. */
  previousEarnedCents: number | null;
  types: IncomeTypeRow[];
  groups: readonly { id: IncomeGroup; label: string }[];
  /** The next twelve months from regular series, when the view ends today. */
  projection: { month: string; byGroup: Record<IncomeGroup, number> }[];
  /** Windfalls of the last twelve months, a year on: outside the projected totals. */
  markers: { month: string; label: string; cents: number }[];
  changes: IncomeChange[];
  stability: IncomeStability | null;
  payDays: IncomePayDay[];
  members: IncomeMember[] | null;
}

const zeroGroups = (): Record<IncomeGroup, number> => Object.fromEntries(INCOME_GROUPS.map((g) => [g.id, 0])) as Record<IncomeGroup, number>;
const MIN_COMPOSITION_MONTHS = 3;
const STABILITY_MONTHS = 12;
const WEEKS_PER_MONTH = 52 / 12;

/** A regular series still pays when its last payment is within its usual gap plus ten days. */
const stillPaying = (b: IncomeBase, s: IncomeBase["series"][number]) => dayNumber(b.end) - s.rows[s.rows.length - 1]!.day <= s.gapDays + 10;

function stabilityOf(values: readonly { month: string; cents: number }[]): IncomeStability | null {
  if (values.length < STABILITY_MONTHS) return null;
  const cents = values.map((v) => v.cents);
  const mid = median(cents);
  if (mid <= 0) return null;
  const changes = cents.slice(1).map((c, i) => Math.abs(c - cents[i]!));
  const low = values.reduce((a, v) => (v.cents < a.cents ? v : a));
  let run = 0;
  let worst = 0;
  for (const c of cents) {
    run = c < mid ? run + (mid - c) : 0;
    worst = Math.max(worst, run);
  }
  return {
    medianCents: Math.round(mid),
    spread: median(changes) / mid,
    lowCents: low.cents,
    lowMonth: low.month,
    lowShare: (mid - low.cents) / mid,
    worstRunCents: Math.round(worst),
    worstRunWeeks: Math.round((worst / (mid / WEEKS_PER_MONTH)) * 10) / 10,
  };
}

/** Label of the account's owner in the household view; a joint account both partners linked stays one, never split to a person. */
function memberOf(a: BalanceInput): string {
  if (a.joint) return "Yhteinen tili";
  return a.ownerName ?? "Omat tilit";
}

export function incomeReport(ctx: AnalysisContext, range: DateRange, balances: readonly BalanceInput[] = []): IncomeReport {
  const end = range.to < ctx.today ? range.to : ctx.today;
  const today = end === ctx.today;
  const b = incomeBase(ctx, end);
  const endMonth = monthOf(end);
  const anchor = isCompleteMonth(ctx, endMonth) ? endMonth : addMonths(endMonth, -1);
  const labels = Array.from({ length: 12 }, (_, i) => addMonths(anchor, i - 11));
  const inWindow = new Set(labels);
  const typeOf = (id: string) => b.types.get(id)!;

  const months: IncomeMonth[] = labels.map((month) => ({ month, complete: isCompleteMonth(ctx, month), totalCents: 0, byGroup: zeroGroups() }));
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const prevLabels = new Set(labels.map((m) => addMonths(m, -12)));
  let previous = 0;
  const typeRows = new Map<IncomeType, { total: number; complete: number; payers: Map<string, IncomeRowRef[] & { payer?: string }> }>();
  for (const t of b.rows) {
    const month = monthOf(t.bookingDate);
    const type = typeOf(t.id);
    if (prevLabels.has(month) && INCOME_TYPES[type].earned) previous += t.amountCents;
    const m = byMonth.get(month);
    if (!m) continue;
    m.totalCents += t.amountCents;
    m.byGroup[INCOME_TYPES[type].group] += t.amountCents;
    let row = typeRows.get(type);
    if (!row) typeRows.set(type, (row = { total: 0, complete: 0, payers: new Map() }));
    row.total += t.amountCents;
    if (m.complete) row.complete += t.amountCents;
    const key = fold(t.merchant);
    let list = row.payers.get(key);
    if (!list) row.payers.set(key, (list = Object.assign([] as IncomeRowRef[], { payer: t.merchant })));
    list.push({ id: t.id, date: t.bookingDate, amountCents: t.amountCents });
  }
  const completeMonths = months.filter((m) => m.complete).length;
  const earnedCents = [...typeRows].filter(([type]) => INCOME_TYPES[type].earned).reduce((s, [, r]) => s + r.total, 0);
  const notEarnedCents = [...typeRows].filter(([type]) => !INCOME_TYPES[type].earned).reduce((s, [, r]) => s + r.total, 0);
  const previousCovered = [...prevLabels].every((m) => isCompleteMonth(ctx, m));

  const activeSeries = b.series.filter((s) => today && stillPaying(b, s));
  const nextOf = new Map(activeSeries.filter((s) => s.payDay).map((s) => [`${s.type}|${fold(s.rows[s.rows.length - 1]!.merchant)}`, nextPayDate(addDays(s.rows[s.rows.length - 1]!.bookingDate, 5), s.payDay!)]));
  const types: IncomeTypeRow[] = INCOME_TYPE_ORDER.filter((type) => typeRows.has(type)).map((type) => {
    const r = typeRows.get(type)!;
    const def = INCOME_TYPES[type];
    const payers = [...r.payers.entries()]
      .map(([key, rows]) => ({
        payer: rows.payer!,
        totalCents: rows.reduce((s, x) => s + x.amountCents, 0),
        payments: rows.length,
        usualCents: Math.round(median(rows.map((x) => x.amountCents))),
        lastDate: rows[rows.length - 1]!.date,
        nextDate: nextOf.get(`${type}|${key}`) ?? null,
        rows: rows.slice(-36).reverse(),
      }))
      .sort((x, y) => y.totalCents - x.totalCents);
    return {
      type,
      label: def.label,
      group: def.group,
      regular: def.regular,
      earned: def.earned,
      totalCents: r.total,
      monthlyCents: completeMonths ? Math.round(r.complete / completeMonths) : null,
      share: def.earned && earnedCents > 0 ? r.total / earnedCents : null,
      payers,
    };
  });

  // the next twelve months from the regular series still paying; windfalls stay out of the totals as markers
  const projection = today
    ? Array.from({ length: 12 }, (_, i) => {
        const byGroup = zeroGroups();
        for (const s of activeSeries) byGroup[INCOME_TYPES[s.type].group] += s.usualCents;
        return { month: addMonths(anchor, i + 1), byGroup };
      })
    : [];
  const markers = today
    ? b.rows
        .filter((t) => inWindow.has(monthOf(t.bookingDate)) && ["holiday_pay", "other_pay", "tax_refund"].includes(typeOf(t.id)) && t.amountCents > 0)
        .reduce<{ month: string; label: string; cents: number }[]>((acc, t) => {
          const month = addMonths(monthOf(t.bookingDate), 12);
          const label = INCOME_TYPES[typeOf(t.id)].label;
          const hit = acc.find((x) => x.month === month && x.label === label);
          if (hit) hit.cents += t.amountCents;
          else acc.push({ month, label, cents: t.amountCents });
          return acc;
        }, [])
    : [];

  const regularByMonth = months.filter((m) => m.complete).map((m) => ({ month: m.month, cents: 0 }));
  const regularIndex = new Map(regularByMonth.map((r) => [r.month, r]));
  for (const t of b.rows) {
    // by pay period: pay for the 1st booked on the 31st is that month's pay, so a flat salary has no gap month
    const r = regularIndex.get(b.periodMonth.get(t.id) ?? monthOf(t.bookingDate));
    if (r && INCOME_TYPES[typeOf(t.id)].regular) r.cents += t.amountCents;
  }

  const payDays: IncomePayDay[] = activeSeries
    .filter((s) => s.payDay)
    .map((s) => ({
      label: s.type === "salary" ? "Palkka" : benefitName(s.type),
      payer: s.payer,
      text: payDayText(s.payDay!),
      nextDate: nextPayDate(addDays(s.rows[s.rows.length - 1]!.bookingDate, 5), s.payDay!),
      usualCents: s.usualCents,
    }))
    .sort((x, y) => (x.nextDate! < y.nextDate! ? -1 : 1));

  let members: IncomeMember[] | null = null;
  if (balances.some((a) => a.ownerName !== null)) {
    const labelOf = new Map(balances.map((a) => [a.id, memberOf(a)]));
    const sums = new Map<string, IncomeMember>();
    for (const a of balances) if (!sums.has(labelOf.get(a.id)!)) sums.set(labelOf.get(a.id)!, { label: labelOf.get(a.id)!, earnedCents: 0, regular: false });
    for (const t of b.rows) {
      const member = sums.get(labelOf.get(t.accountId) ?? "");
      if (!member || !inWindow.has(monthOf(t.bookingDate)) || !INCOME_TYPES[typeOf(t.id)].earned) continue;
      member.earnedCents += t.amountCents;
      if (INCOME_TYPES[typeOf(t.id)].regular) member.regular = true;
    }
    members = [...sums.values()];
  }

  return {
    months,
    completeMonths,
    enough: completeMonths >= MIN_COMPOSITION_MONTHS,
    earnedCents,
    notEarnedCents,
    previousEarnedCents: previousCovered ? previous : null,
    types,
    groups: INCOME_GROUPS,
    projection,
    markers,
    changes: incomeChanges(b, today),
    stability: stabilityOf(regularByMonth),
    payDays,
    members,
  };
}
