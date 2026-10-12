// Decision: is our income changing, and does the buffer match how it moves
import { partCents, partOf, WHOLE } from "../account-use.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { INCOME_GROUPS, INCOME_TYPE_ORDER, INCOME_TYPES, type IncomeGroup, type IncomeType, nextPayDate } from "../analysis/income.ts";
import { benefitName, type IncomeBase, incomeBase, type IncomeChange, incomeChanges, payDayText } from "../analysis/income-changes.ts";
import { payPieces } from "../analysis/income-series.ts";
import type { DateRange } from "../analysis/period.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { addDays, addMonths, dayNumber, monthOf } from "../dates.ts";
import { belowWhole } from "../household-debts.ts";
import { fold } from "../merchant.ts";
import { median } from "../stats.ts";
import type { BalanceInput, IsoDate, Part } from "../types.ts";

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
  /** The spread is under STEADY_SPREAD: the page says the income barely moves. */
  steady: boolean;
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
  /** Earned income against the twelve months before, as a share of them; null without them. */
  earnedChange: number | null;
  /** What the parts wait for, so the page names the same numbers the report uses. */
  needs: { compositionMonths: number; stabilityMonths: number; previousYearMonths: number; steadySpread: number };
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
/** The comparison with the year before needs this year's twelve months and the twelve before them. */
const PREVIOUS_YEAR_MONTHS = 24;
/** A median month-to-month change under 3 % reads as steady income. */
const STEADY_SPREAD = 0.03;
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
    steady: median(changes) / mid < STEADY_SPREAD,
    lowCents: low.cents,
    lowMonth: low.month,
    lowShare: (mid - low.cents) / mid,
    worstRunCents: Math.round(worst),
    worstRunWeeks: Math.round((worst / (mid / WEEKS_PER_MONTH)) * 10) / 10,
  };
}

/**
 * Whose income an account's is in the household view: a label for each, with the part of every row that is theirs.
 * An account whose use is known is its users': one member's when one uses it, also when another member linked it, and
 * split by the users' parts when several do, the holders who are no member under their own label. The parts of a row
 * add up to the row. Where the use is not known the account is its owner's, and a joint account both partners linked
 * stays one line.
 */
function membersOf(a: BalanceInput): { label: string; part: Part }[] {
  const use = a.use;
  const users = use?.users.filter((u) => u.weight > 0) ?? [];
  if (!use || !users.length) return [{ label: a.joint ? "Yhteinen tili" : (a.ownerName ?? "Omat tilit"), part: WHOLE }];
  return users.map((u) => ({ label: u.label, part: partOf(use, u.userId) }));
}

export function incomeReport(ctx: AnalysisContext, range: DateRange, balances: readonly BalanceInput[] = []): IncomeReport {
  const end = range.to < ctx.today ? range.to : ctx.today;
  const today = end === ctx.today;
  const b = incomeBase(ctx, end);
  const anchor = b.anchor;
  const labels = Array.from({ length: 12 }, (_, i) => addMonths(anchor, i - 11));
  const inWindow = new Set(labels);
  const typeOf = (id: string) => b.types.get(id)!;

  const months: IncomeMonth[] = labels.map((month) => ({ month, complete: isCompleteMonth(ctx, month), totalCents: 0, byGroup: zeroGroups() }));
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const prevLabels = new Set(labels.map((m) => addMonths(m, -12)));
  let previous = 0;
  const typeRows = new Map<IncomeType, { total: number; complete: number; payers: Map<string, IncomeRowRef[] & { payer?: string }> }>();
  // a payment is one part, or two when a regular payer's only payment stands above the usual level
  const parts = b.rows.flatMap((t) => payPieces(b, t).map((p) => ({ t, ...p })));
  for (const { t, type, cents } of parts) {
    const month = monthOf(t.bookingDate);
    if (prevLabels.has(month) && INCOME_TYPES[type].earned) previous += cents;
    const m = byMonth.get(month);
    if (!m) continue;
    m.totalCents += cents;
    m.byGroup[INCOME_TYPES[type].group] += cents;
    let row = typeRows.get(type);
    if (!row) typeRows.set(type, (row = { total: 0, complete: 0, payers: new Map() }));
    row.total += cents;
    if (m.complete) row.complete += cents;
    const key = fold(t.merchant);
    let list = row.payers.get(key);
    if (!list) row.payers.set(key, (list = Object.assign([] as IncomeRowRef[], { payer: t.merchant })));
    list.push({ id: t.id, date: t.bookingDate, amountCents: cents });
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
    ? parts
        .filter(({ t, type, cents }) => inWindow.has(monthOf(t.bookingDate)) && ["holiday_pay", "other_pay", "tax_refund"].includes(type) && cents > 0)
        .reduce<{ month: string; label: string; cents: number }[]>((acc, { t, type, cents }) => {
          const month = addMonths(monthOf(t.bookingDate), 12);
          const label = INCOME_TYPES[type].label;
          const hit = acc.find((x) => x.month === month && x.label === label);
          if (hit) hit.cents += cents;
          else acc.push({ month, label, cents });
          return acc;
        }, [])
    : [];

  const regularByMonth = months.filter((m) => m.complete).map((m) => ({ month: m.month, cents: 0 }));
  const regularIndex = new Map(regularByMonth.map((r) => [r.month, r]));
  for (const { t, type, cents } of parts) {
    // by pay period: pay for the 1st booked on the 31st is that month's pay, so a flat salary has no gap month
    const r = regularIndex.get(b.periodMonth.get(t.id) ?? monthOf(t.bookingDate));
    if (r && INCOME_TYPES[type].regular) r.cents += cents;
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
  const whose = new Map(balances.map((a) => [a.id, membersOf(a)]));
  // an account at a part holds the viewer's part of each row and nobody else's: a member's own view, which has no split
  const ownView = balances.some((a) => belowWhole(a.part));
  if (!ownView && balances.some((a) => a.ownerName !== null || whose.get(a.id)!.length > 1)) {
    const sums = new Map<string, IncomeMember>();
    for (const users of whose.values()) for (const { label } of users) if (!sums.has(label)) sums.set(label, { label, earnedCents: 0, regular: false });
    for (const t of b.rows) {
      const users = whose.get(t.accountId);
      if (!users || !inWindow.has(monthOf(t.bookingDate)) || !INCOME_TYPES[typeOf(t.id)].earned) continue;
      for (const { label, part } of users) {
        const member = sums.get(label)!;
        member.earnedCents += partCents(t.amountCents, part);
        if (INCOME_TYPES[typeOf(t.id)].regular) member.regular = true;
      }
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
    earnedChange: previousCovered && previous ? (earnedCents - previous) / previous : null,
    needs: { compositionMonths: MIN_COMPOSITION_MONTHS, stabilityMonths: STABILITY_MONTHS, previousYearMonths: PREVIOUS_YEAR_MONTHS, steadySpread: STEADY_SPREAD },
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
