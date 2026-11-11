/**
 * What changed in the income: pay level per payer (with the tax-card guards), variable pay, benefits that ended,
 * started or changed, a new payer, pay that did not come, new sources, windfalls against last year and residual tax.
 * Each change has its number, its basis and its rows. `incomeInsights` returns the ones that are insights
 * (H-insights candidates 1 to 4 and 17); a missing salary is an alert and stays in the income report.
 */
import { addDays, addMonths, dayNumber, fromDayNumber, monthOf } from "../dates.ts";
import { fold } from "../merchant.ts";
import { median } from "../stats.ts";
import type { IsoDate, UserInputs } from "../types.ts";
import type { AnalysisContext } from "./context.ts";
import { accountCovers } from "./coverage.ts";
import { formatEur, formatFiDate } from "./format.ts";
import { addBankingDays, JOB_END_WORDS, nextPayDate, payerKey } from "./income.ts";
import { newSources, residualTax, windfalls } from "./income-events.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { type MessageCode, type MessageParams, messageIn } from "../messages.ts";
import { benefitName, eur, type IncomeBase, incomeBase, type IncomeChange, type IncomeChangeKind, type IncomeSeries, isKela, monthFrom, monthIn, passes, payDayWhen, type Period, shortDate } from "./income-series.ts";
import type { DateRange } from "./period.ts";
import { expectedLevel } from "./expected.ts";
import { completeMonthsBefore } from "./usual.ts";
import { BASE_SPREAD, BENEFIT_GRACE_DAYS, FIRST_PAGE_DAYS, LEVEL_SPREAD, MIN_STEP_SHARE, PAY_GRACE_BANKING_DAYS, SWITCH_DAYS, SWITCH_LEVEL, SWITCH_PERIODS, VARIABLE_SPREAD } from "../thresholds.ts";
import { insightOf, REPORT } from "./insights/shared.ts";
import { type Insight, q } from "./insights/types.ts";

export type { IncomeBase, IncomeChange } from "./income-series.ts";
export { benefitName, incomeBase, payDayText } from "./income-series.ts";

/** The first letter of a name in capitals or, for the middle of a sentence, small unless the name is Kela's. */
const capital = (text: string) => text[0]!.toUpperCase() + text.slice(1);
const lowerName = (name: string) => (name.startsWith("Kela") ? name : name[0]!.toLowerCase() + name.slice(1));

// ── detectors ──

export function levelStep(p: readonly Period[]): { base: number; level: number; start: Period; run: number; basePeriods: number } | null {
  const n = p.length;
  if (n < 5) return null;
  const last = p[n - 1]!.cents;
  let j = n - 1;
  while (j > 0 && Math.abs(p[j - 1]!.cents - last) <= last * LEVEL_SPREAD) j--;
  if (n - j < 2) return null;
  const base = p.slice(Math.max(0, j - 6), j).map((x) => x.cents);
  if (base.length < 3) return null;
  const bm = median(base);
  const noise = Math.max(...base) - Math.min(...base);
  if (noise > bm * BASE_SPREAD) return null;
  const level = median(p.slice(j).map((x) => x.cents));
  // a step must stand clear of the base's own wobble: its range and 2,5 % of its level, or pay that varies by a few
  // percent reads as a raise or a cut
  if (Math.abs(level - bm) < Math.max(noise, MIN_STEP_SHARE * bm)) return null;
  return { base: Math.round(bm), level: Math.round(level), start: p[j]!, run: n - j, basePeriods: base.length };
}


function savedUsually(b: IncomeBase, from: IsoDate): number | null {
  const months = completeMonthsBefore(b.ctx, monthOf(from));
  const saved = new Map<string, number>();
  for (const t of b.ctx.txs) if (t.flows.saved) saved.set(monthOf(t.bookingDate), (saved.get(monthOf(t.bookingDate)) ?? 0) + t.flows.saved);
  return expectedLevel(months.map((m) => saved.get(m) ?? 0));
}

function payChanges(b: IncomeBase, s: IncomeSeries, lang: Language): IncomeChange[] {
  const m = <C extends MessageCode>(code: C, ...params: MessageParams<C>) => messageIn(lang, code, ...params);
  const yearAgo = fromDayNumber(dayNumber(b.end) - 365);
  const step = levelStep(s.periods);
  const idsFrom = (d: IsoDate) => s.rows.filter((t) => t.bookingDate >= d).map((t) => t.id);
  if (step && step.start.date >= yearAgo && passes(b, step.level - step.base)) {
    const diff = step.level - step.base;
    // by pay period, not booking date: pay for 1.1. is often booked on 31.12.
    const startMonth = `${step.start.month}-01`;
    const month = Number(step.start.month.slice(5, 7));
    const before = s.periods[s.periods.indexOf(step.start) - 1];
    const firstOfYear = !before || before.month.slice(0, 4) < step.start.month.slice(0, 4);
    const up = diff > 0;
    const id = `income:pay:${s.key}:${step.start.month}`;
    const calc = [
      { label: m("inc.before_month"), value: eur(step.base, lang) },
      { label: m("inc.now_month"), value: eur(step.level, lang) },
      { label: m("inc.change_month"), value: eur(diff, lang) },
    ];
    const from = monthFrom(startMonth, lang);
    const common = { id, type: s.type, payer: s.payer, beforeCents: step.base, monthlyCents: diff, yearlyCents: Math.abs(diff) * 12, txIds: idsFrom(step.start.date), calc };
    // a new tax card and the employee contributions change in January: a net step with the year's first pay is not a raise
    if (firstOfYear)
      return [{ ...common, kind: "tax_card", title: m(up ? "inc.net_up" : "inc.net_down", { amount: eur(diff, lang) }), detail: m("inc.tax_card_detail", { payer: s.payer, from, level: eur(step.level, lang) }) }];
    if (!up && month >= 9)
      return [{ ...common, kind: "tax_limit", title: m("inc.net_down", { amount: eur(diff, lang) }), detail: m("inc.tax_limit_detail", { payer: s.payer, from }) }];
    const saved = up ? savedUsually(b, step.start.date) : null;
    return [
      {
        ...common,
        kind: up ? "raise" : "cut",
        title: m(up ? "inc.pay_up" : "inc.pay_down", { amount: eur(diff, lang) }),
        detail: m("inc.pay_detail", { payer: s.payer, run: step.run, from, saved: saved !== null && saved > 0 ? m("inc.pay_saved", { amount: eur(saved, lang) }) : "" }),
      },
    ];
  }
  const recent = s.periods.filter((p) => p.date >= yearAgo);
  if (recent.length >= 6) {
    const values = recent.map((p) => p.cents);
    const mid = median(values);
    const low = Math.min(...values);
    const high = Math.max(...values);
    // the median change, as stability measures it: two low months (an autumn income limit) are not variable pay
    const spread = median(values.slice(1).map((v, i) => Math.abs(v - values[i]!))) / mid;
    if (spread > VARIABLE_SPREAD && passes(b, mid - low)) {
      const lowP = recent.find((p) => p.cents === low)!;
      return [
        {
          id: `income:variable:${s.key}`,
          kind: "variable",
          beforeCents: Math.round(mid),
          type: s.type,
          payer: s.payer,
          title: m("inc.pay_varied", { low: lang === "en" ? eur(low, lang) : eur(low).replace(/\s€$/, ""), high: eur(high, lang) }),
          detail: m("inc.pay_varied_detail", { payer: s.payer, n: recent.length, when: monthIn(lowP.date, lang), low: eur(low, lang) }),
          monthlyCents: -(mid - low),
          yearlyCents: (mid - low) * 12,
          calc: [
            { label: m("inc.lowest_month"), value: eur(low, lang) },
            { label: m("inc.highest_month"), value: eur(high, lang) },
            { label: m("inc.median_month"), value: eur(mid, lang) },
            { label: m("inc.months"), value: String(recent.length) },
          ],
          txIds: s.rows.filter((t) => t.bookingDate >= yearAgo).map((t) => t.id),
        },
      ];
    }
  }
  return [];
}

function benefitStep(b: IncomeBase, s: IncomeSeries, lang: Language): IncomeChange | null {
  const step = levelStep(s.periods);
  const yearAgo = fromDayNumber(dayNumber(b.end) - 365);
  if (step && step.start.date >= yearAgo && passes(b, step.level - step.base)) {
    const diff = step.level - step.base;
    return {
      id: `income:benefit-step:${s.key}:${step.start.month}`,
      kind: "benefit_step",
      type: s.type,
      payer: s.payer,
      beforeCents: step.base,
      title: messageIn(lang, diff > 0 ? "inc.ben_up" : "inc.ben_down", { name: benefitName(s.type, lang), amount: eur(diff, lang) }),
      detail: messageIn(lang, "inc.ben_step_detail", { from: capital(monthFrom(`${step.start.month}-01`, lang)), level: eur(step.level, lang), base: eur(step.base, lang) }),
      monthlyCents: diff,
      yearlyCents: Math.abs(diff) * 12,
      txIds: s.rows.filter((t) => t.bookingDate >= step.start.date).map((t) => t.id),
      calc: [
        { label: messageIn(lang, "inc.before_month"), value: eur(step.base, lang) },
        { label: messageIn(lang, "inc.now_month"), value: eur(step.level, lang) },
        { label: messageIn(lang, "inc.change_month"), value: eur(diff, lang) },
      ],
    };
  }
  return null;
}

/** The benefit has ended: its gap plus ten days passed and the account has later rows, so the sync is not behind. */
function hasEnded(b: IncomeBase, s: IncomeSeries): boolean {
  const last = s.rows[s.rows.length - 1]!;
  const deadline = last.day + s.gapDays + BENEFIT_GRACE_DAYS;
  return s.rows.length >= 3 && dayNumber(b.end) > deadline && (b.lastDay.get(s.accountId) ?? 0) > deadline && dayNumber(b.end) - last.day <= 180;
}

function hasStarted(b: IncomeBase, s: IncomeSeries): boolean {
  const first = s.rows[0]!;
  return s.rows.length >= 2 && dayNumber(b.end) - first.day <= 120 && accountCovers(b.ctx, [s.accountId], addDays(first.bookingDate, -92));
}

function benefitEvents(b: IncomeBase, benefits: IncomeSeries[], lang: Language): IncomeChange[] {
  const m = <C extends MessageCode>(code: C, ...params: MessageParams<C>) => messageIn(lang, code, ...params);
  const out: IncomeChange[] = [];
  const ended = benefits.filter((s) => hasEnded(b, s));
  const started = benefits.filter((s) => hasStarted(b, s));
  const used = new Set<IncomeSeries>();
  for (const a of ended) {
    const last = a.rows[a.rows.length - 1]!;
    // Kela renames or splits a benefit: a stop and a start from the same payer close together is one change
    const next = started.find((s) => !used.has(s) && (isKela(s.type) ? isKela(a.type) : payerKey(s.rows[0]!) === payerKey(last)) && Math.abs(s.rows[0]!.day - last.day) <= SWITCH_DAYS);
    if (next) {
      used.add(next);
      const diff = next.usualCents - a.usualCents;
      out.push({
        id: `income:benefit-changed:${a.key}:${next.key}`,
        kind: "benefit_changed",
        type: next.type,
        payer: next.payer,
        beforeCents: a.usualCents,
        title: m("inc.ben_changed", { name: benefitName(a.type, lang), next: lowerName(benefitName(next.type, lang)), amount: eur(next.usualCents, lang) }),
        detail: m("inc.ben_changed_detail", { before: eur(a.usualCents, lang), date: formatFiDate(last.bookingDate, lang) }),
        monthlyCents: diff,
        yearlyCents: Math.abs(diff) * 12,
        txIds: [...a.rows.slice(-3), ...next.rows].map((t) => t.id),
        calc: [
          { label: m("inc.before_month"), value: eur(a.usualCents, lang) },
          { label: m("inc.now_month"), value: eur(next.usualCents, lang) },
        ],
      });
      continue;
    }
    if (!passes(b, a.usualCents)) continue;
    out.push({
      id: `income:benefit-ended:${a.key}:${last.bookingDate}`,
      kind: "benefit_ended",
      type: a.type,
      payer: a.payer,
      beforeCents: a.usualCents,
      title: m("inc.ben_ended", { name: benefitName(a.type, lang), amount: formatEur(-a.usualCents, false, lang).replace("-", "−") }),
      detail: m("inc.ben_ended_detail", { date: formatFiDate(last.bookingDate, lang), paid: a.payDay ? m("inc.ben_paid_on", { when: payDayWhen(a.payDay, lang) }) : "" }),
      monthlyCents: -a.usualCents,
      yearlyCents: a.usualCents * 12,
      txIds: a.rows.slice(-3).map((t) => t.id),
      calc: [
        { label: m("inc.usual_month"), value: eur(a.usualCents, lang) },
        { label: m("inc.last_payment"), value: formatFiDate(last.bookingDate, lang) },
      ],
    });
  }
  for (const s of started) {
    if (used.has(s) || !passes(b, s.usualCents)) continue;
    out.push({
      id: `income:benefit-started:${s.key}:${s.rows[0]!.bookingDate}`,
      kind: "benefit_started",
      type: s.type,
      payer: s.payer,
      title: m("inc.ben_started", { name: benefitName(s.type, lang), amount: eur(s.usualCents, lang) }),
      detail: m("inc.ben_started_detail", { date: formatFiDate(s.rows[0]!.bookingDate, lang), n: s.rows.length }),
      monthlyCents: s.usualCents,
      yearlyCents: s.usualCents * 12,
      txIds: s.rows.map((t) => t.id),
      calc: [
        { label: m("inc.per_month"), value: eur(s.usualCents, lang) },
        { label: m("inc.payments"), value: String(s.rows.length) },
      ],
    });
  }
  for (const s of benefits) if (!ended.includes(s) && !started.includes(s)) {
    const c = benefitStep(b, s, lang);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Salary that did not come, read at the end of the window: a payer that changed, or pay that stopped, when its last
 * payment falls in the window; one missed pay day only in a view of today.
 */
function payMissing(b: IncomeBase, salaries: IncomeSeries[], today: boolean, lang: Language): { changes: IncomeChange[]; newSeries: Set<IncomeSeries> } {
  const changes: IncomeChange[] = [];
  const newSeries = new Set<IncomeSeries>();
  for (const s of salaries) {
    if (s.periods.length < 3) continue;
    const lastMain = s.rows[s.rows.length - 1]!;
    if (lastMain.bookingDate < b.from) continue;
    const pd = s.payDay;
    const e1 = pd ? nextPayDate(addDays(lastMain.bookingDate, 5), pd) : fromDayNumber(lastMain.day + Math.round(s.gapDays));
    const due1 = addBankingDays(e1, PAY_GRACE_BANKING_DAYS);
    if (b.end <= due1 || (b.lastDay.get(s.accountId) ?? 0) <= dayNumber(due1)) continue;
    const key = payerKey(lastMain);
    const later = b.rows.filter((t) => t.category === "salary" && t.amountCents > 0 && payerKey(t) === key && t.day > lastMain.day);
    if (later.some((t) => t.bookingDate >= addDays(e1, -10))) continue;
    // holiday pay paid ahead in summer makes the next pay day look empty
    const summer = ["06", "07", "08"].includes(e1.slice(5, 7));
    if (summer && later.some((t) => b.types.get(t.id) === "holiday_pay")) continue;
    // another payer began within two pay periods of the last payment: one change, whatever the new level; a payer
    // with a single payment so far needs a level near the old one to be no stray row. A payer already taken as the
    // successor of another stays with that one. One on the same account comes first; on another account (another
    // member's pay or side job) only a payer at the old level is the successor, whatever its length. Of the payers that
    // fit, the one whose level is nearest the old payer's is the successor, not the one paid first.
    const lastPeriod = s.periods[s.periods.length - 1]!.month;
    const levelGap = (o: IncomeSeries) => Math.abs(o.usualCents - s.usualCents);
    const nearLevel = (o: IncomeSeries) => levelGap(o) <= s.usualCents * SWITCH_LEVEL;
    const nearest = (list: IncomeSeries[]) => list.reduce<IncomeSeries | undefined>((best, o) => (!best || levelGap(o) < levelGap(best) ? o : best), undefined);
    const began = salaries.filter(
      (o) =>
        o !== s &&
        !newSeries.has(o) &&
        o.rows[0]!.day > s.rows[0]!.day &&
        o.rows[0]!.day >= lastMain.day - 15 &&
        o.periods[0]!.month <= addMonths(lastPeriod, SWITCH_PERIODS),
    );
    const other = nearest(began.filter((o) => o.accountId === s.accountId && (o.periods.length >= 2 || nearLevel(o)))) ?? nearest(began.filter((o) => o.accountId !== s.accountId && nearLevel(o)));
    if (other) {
      newSeries.add(other);
      const diff = other.usualCents - s.usualCents;
      changes.push({
        id: `income:payer-changed:${s.key}:${other.key}`,
        kind: "payer_changed",
        type: "salary",
        payer: other.payer,
        beforeCents: s.usualCents,
        title: messageIn(lang, "inc.payer_changed", { amount: eur(other.usualCents, lang) }),
        detail: messageIn(lang, "inc.payer_changed_detail", { payer: s.payer, other: other.payer, date: formatFiDate(other.rows[0]!.bookingDate, lang), before: eur(s.usualCents, lang) }),
        monthlyCents: diff,
        yearlyCents: Math.abs(diff) * 12,
        txIds: [...s.rows.slice(-2), ...other.rows].map((t) => t.id),
        calc: [
          { label: messageIn(lang, "inc.before_month"), value: eur(s.usualCents, lang) },
          { label: messageIn(lang, "inc.now_month"), value: eur(other.usualCents, lang) },
        ],
        lastPaid: lastMain.bookingDate,
      });
      continue;
    }
    const e2 = pd ? nextPayDate(addDays(e1, 5), pd) : fromDayNumber(dayNumber(e1) + Math.round(s.gapDays));
    const jobEnd = later.find((t) => JOB_END_WORDS.test(fold(`${t.merchant} ${t.description ?? ""}`)));
    if (jobEnd || b.end > addBankingDays(e2, PAY_GRACE_BANKING_DAYS)) {
      changes.push({
        id: `income:stopped:${s.key}:${lastMain.bookingDate}`,
        kind: "stopped",
        type: "salary",
        payer: s.payer,
        title: messageIn(lang, "inc.stopped", { date: shortDate(lastMain.bookingDate, lang) }),
        detail: messageIn(lang, "inc.stopped_detail", {
          payer: s.payer,
          usual: eur(s.usualCents, lang),
          end: jobEnd ? messageIn(lang, "inc.stopped_end", { amount: eur(jobEnd.amountCents, lang), date: formatFiDate(jobEnd.bookingDate, lang) }) : "",
        }),
        monthlyCents: -s.usualCents,
        yearlyCents: s.usualCents * 12,
        txIds: [...s.rows.slice(-2), ...later].map((t) => t.id),
        lastPaid: lastMain.bookingDate,
      });
      continue;
    }
    if (!today || !pd || s.periods.length < 6) continue;
    const lastSeen = fromDayNumber(b.lastDay.get(s.accountId)!);
    changes.push({
      id: `income:missing:${s.key}:${e1}`,
      kind: "missing",
      type: "salary",
      payer: s.payer,
      title: messageIn(lang, "inc.missing", { date: shortDate(e1, lang) }),
      detail: messageIn(lang, "inc.missing_detail", { payer: s.payer, hits: pd.hits, when: payDayWhen(pd, lang), date: formatFiDate(lastSeen, lang) }),
      monthlyCents: -s.usualCents,
      yearlyCents: s.usualCents * 12,
      txIds: s.rows.slice(-3).map((t) => t.id),
    });
  }
  return { changes, newSeries };
}

export function incomeChanges(b: IncomeBase, today: boolean, lang: Language = DEFAULT_LANGUAGE): IncomeChange[] {
  const salaries = b.series.filter((s) => s.type === "salary");
  const benefits = b.series.filter((s) => s.type !== "salary");
  const missing = payMissing(b, salaries, today, lang);
  const skip = new Set<string>([...missing.newSeries].map((s) => payerKey(s.rows[0]!)));
  for (const s of benefits) if (hasStarted(b, s)) skip.add(payerKey(s.rows[0]!));
  const out = [
    ...missing.changes,
    ...salaries.filter((s) => !missing.newSeries.has(s)).flatMap((s) => payChanges(b, s, lang)),
    ...(today ? benefitEvents(b, benefits, lang) : benefits.map((s) => benefitStep(b, s, lang)).filter((c): c is IncomeChange => c !== null)),
    ...newSources(b, skip, lang),
    ...windfalls(b, lang),
  ];
  const tax = residualTax(b, lang);
  if (tax) out.push(tax);
  return out.sort((x, y) => Math.abs(y.monthlyCents) - Math.abs(x.monthlyCents));
}

/** The insight kinds of H-insights candidates 1 to 4 and 17; a missing or stopped salary is an alert. */
const INSIGHT_KINDS: ReadonlySet<IncomeChangeKind> = new Set([
  "raise",
  "cut",
  "tax_limit",
  "payer_changed",
  "benefit_ended",
  "benefit_started",
  "benefit_changed",
  "benefit_step",
  // a windfall ("Lomaraha 3 463 € tuli 23.8.") repeats what came in and would outrank every real finding by its size;
  // the income report lists it under Mikä muuttui
  "residual_tax",
  "new_source",
]);

/** A level change recurs every month; a new source or a residual tax is one event. */
const SINGLE_KINDS: ReadonlySet<IncomeChangeKind> = new Set(["residual_tax", "new_source"]);

/**
 * Income insights in the shape of analysis/insights/types.ts. The report keeps a change of payer for twelve months; the
 * first page drops one whose old payer was last paid over `FIRST_PAGE_DAYS` before the end of the view: there a change
 * is news for about four months, not for a year. The comparison is the level before; the change is worth twelve
 * months of the monthly difference.
 */
export function incomeInsights(ctx: AnalysisContext, range: DateRange, _inputs: UserInputs, lang: Language = DEFAULT_LANGUAGE): Insight[] {
  const end = range.to < ctx.today ? range.to : ctx.today;
  const b = incomeBase(ctx, end);
  return incomeChanges(b, end === ctx.today, lang)
    .filter((c) => INSIGHT_KINDS.has(c.kind) && (!c.lastPaid || dayNumber(end) - dayNumber(c.lastPaid) <= FIRST_PAGE_DAYS))
    .map((c) =>
      insightOf({
        id: c.id,
        fact: { type: "income", change: c.kind, title: c.title, monthlyCents: c.monthlyCents },
        comparison: c.unknownBefore ? { label: "lastInstalment", value: q.date(c.unknownBefore) } : { label: c.kind === "residual_tax" ? "yearAgo" : "incomeBefore", value: q.cents(c.beforeCents ?? 0) },
        action: { label: "seeIncome", target: { page: "reports", anchor: REPORT.income } },
        yearlyCents: c.monthlyCents * 12,
        kind: SINGLE_KINDS.has(c.kind) ? "single" : "pattern",
        rows: c.txIds,
        ...(c.payer && c.payer !== "Kela" ? { merchant: c.payer } : {}),
        calc: c.calc ?? [],
      }),
    );
}
