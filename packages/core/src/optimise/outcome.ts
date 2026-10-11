/**
 * Seuranta: did a change the household marked done help, judged from its own complete months (F section 4). A verdict
 * never claims more than the data shows: medians, so a finding that started from a spike cannot read as a saving when
 * the spending returns to its usual size; the changeover month left out of the months compared; a contract compared by
 * its cost per month at its cadence, waiting while a new charge forms no series; a wait of two complete months for a
 * monthly item and one cycle for a quarterly or yearly one; and a switch to a new payee counts the new payee. The
 * monthly snapshot is in snapshot.ts. Pure: `ctx.today` is the only clock.
 */
import type { AnalysisContext, AnalysisTx } from "../analysis/context.ts";
import { formatEur, formatFiDate } from "../analysis/format.ts";
import { ITEM_GATE_MONTHLY_CENTS } from "../analysis/insights/shared.ts";
import { paysAhead, type Replacement, replacementOf } from "../analysis/insights/stopped.ts";
import { completeMonthsBefore, isCompleteMonth } from "../analysis/usual.ts";
import { addDays, addMonths, monthEnd, monthOf, monthRange } from "../dates.ts";
import { detectRecurring, parseSeriesId, type RecurringSeries } from "../recurring.ts";
import { median } from "../stats.ts";
import type { IsoDate } from "../types.ts";
import { netCost, parseFindingId, rowsById } from "./common.ts";
import { cpiChange } from "./facts/index.ts";
import { shownFindings, type Snapshot } from "./snapshot.ts";
import type { Finding, FindingState, Measure, OptimiseData } from "./types.ts";

export * from "./snapshot.ts";

export const VERDICTS = ["vahvistui", "todennäköinen", "epäselvä", "huonompi", "odottaa"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** What came of a done finding. */
export interface FindingOutcome {
  verdict: Verdict;
  /** Cents a month less than before the change, negative when more; null while waiting or when nothing can be measured. */
  monthlyCents: number | null;
  /** One or two Finnish sentences: the number first, its basis after. */
  reason: string;
  /** A new payee took over the stopped payment; its charges are in the figures. */
  replacement?: { merchant: string; date: IsoDate; text: string };
}

/** What the follow-up reads of a finding: what it measures and, to tell a cancellation, its action. */
export type FollowedFinding = Pick<Finding, "measure"> & Partial<Pick<Finding, "action">>;

/** The data shows an active finding's change: the page asks for a confirmation and never marks it done itself. */
export interface SwitchProposal {
  findingId: string;
  /** The first charge of the new payee: the effective date the confirmation stores. */
  date: IsoDate;
  text: string;
}

/** One point of the line: euros a year found that month against the euros a year the follow-up confirmed by then. */
export interface FollowUpPoint {
  month: string;
  foundCents: number;
  confirmedCents: number;
}

export interface FollowUp {
  /** One per done decision, in the order of `data.done`. */
  outcomes: { findingId: string; outcome: FindingOutcome }[];
  proposals: SwitchProposal[];
  /** Oldest first, at most `LINE_MONTHS`. */
  line: FollowUpPoint[];
}

/** Vahvistui: the after median is lower by this share of the monthly mid, and every after month is below the baseline. */
export const CONFIRMED_SHARE = 0.8;
/** Todennäköinen from this share. */
export const LIKELY_SHARE = 0.5;
/** A monthly item waits this many complete months after the changeover month. */
export const MONTHLY_WAIT = 2;
/** Points on the follow-up line. */
export const LINE_MONTHS = 12;
/** Complete months before the change the baseline median stands on: a year, so a spike of a few months stays out. */
const BEFORE_MONTHS = 12;
/** Under this many complete months before the change there is nothing to compare with. */
const MIN_BEFORE_MONTHS = 3;
/** A proposal names a day the done decision can still store (the route allows a year back). */
const PROPOSAL_DAYS = 365;
/** A CPI row this many months older than the month still deflates it: the statistic is published with a lag. */
const CPI_LAG_MONTHS = 3;
/** A charge within this share of a series' typical price is a charge of that series at its cadence. */
const SAME_PRICE = 0.5;

const eur = (cents: number) => formatEur(Math.abs(Math.round(cents)), false);

/** "13 € kuussa vähemmän", "8 € kuussa enemmän", "±0 € kuussa". */
function difference(effect: number): string {
  const rounded = Math.round(effect / 100) * 100;
  if (rounded === 0) return `±${formatEur(0, false)} kuussa`;
  return `${eur(rounded)} kuussa ${rounded > 0 ? "vähemmän" : "enemmän"}`;
}

/** The measure of a done finding: the finding's own, or read from its id when the finding no longer shows. */
function measureOf(ctx: AnalysisContext, findingId: string, finding: FollowedFinding | null): Measure | null {
  if (finding) return finding.measure;
  const subject = parseFindingId(findingId)?.subject;
  if (!subject) return null;
  const series = ctx.recurring.find((s) => s.id === subject);
  // the series' own charges a year: day care that is free in July bills 11 times
  if (series) return { kind: "series", keys: [subject], perYear: series.perMonth * 12 };
  const merchant = parseSeriesId(subject)?.merchant ?? subject;
  return ctx.txs.some((t) => t.merchant === merchant) ? { kind: "merchants", keys: [merchant] } : null;
}

/** The recurring series a measure is about: its series, or the subscriptions and bills of its merchants. */
function seriesOf(ctx: AnalysisContext, measure: Measure): RecurringSeries[] {
  const keys = new Set(measure.keys);
  if (measure.kind === "series") return ctx.recurring.filter((s) => keys.has(s.id));
  if (measure.kind === "merchants" || measure.kind === "unit") return ctx.recurring.filter((s) => keys.has(s.merchant) && (s.kind === "subscription" || s.kind === "bill"));
  return [];
}

/** The new payee of a measure whose every payment has stopped, with the series it replaced; null while one still runs. */
function switchOf(ctx: AnalysisContext, measure: Measure): { from: RecurringSeries; to: Replacement } | null {
  const series = seriesOf(ctx, measure);
  if (!series.length || series.some((s) => s.active)) return null;
  const from = series.reduce((a, b) => (b.lastDate > a.lastDate ? b : a));
  const to = replacementOf(ctx, from, ctx.today);
  return to && !measure.keys.includes(to.merchant) ? { from, to } : null;
}

/**
 * Rows the measure counts. A series counts every row of its merchant in its category too, so a contract that came
 * back as a new series after a price change is still measured, and a cancelled one never reads as free while it bills.
 */
function matcherOf(ctx: AnalysisContext, measure: Measure, replacement: string | null): (t: AnalysisTx) => boolean {
  const keys = new Set(measure.keys);
  const extra = (t: AnalysisTx) => replacement !== null && t.merchant === replacement;
  switch (measure.kind) {
    case "series": {
      const series = seriesOf(ctx, measure);
      const ids = new Set(series.flatMap((s) => s.transactionIds));
      const pairs = new Set(series.map((s) => `${s.merchant}\u0000${s.category}`));
      return (t) => ids.has(t.id) || pairs.has(`${t.merchant}\u0000${t.category}`) || extra(t);
    }
    case "merchants":
    case "unit":
      return (t) => keys.has(t.merchant) || extra(t);
    case "category":
      return (t) => keys.has(t.category) || extra(t);
    case "season":
      return (t) => !keys.size || keys.has(t.category) || extra(t);
    case "none":
      return () => false;
  }
}

/**
 * Cost per month of a contract after the change, from charges on or after the first day of the changeover month,
 * normalised by cadence. A series of the whole history that billed before the change and bills after it keeps its
 * cadence; its charges in the changeover month alone are the old contract's last bill and count for nothing. The
 * other charges must form a series of their own; a charge that does not is `loose`, and the verdict waits for it.
 */
function afterCost(ctx: AnalysisContext, rows: readonly AnalysisTx[], start: IsoDate, end: IsoDate, changeover: string): { monthly: number; loose: number } {
  const covered = new Set<string>();
  const byId = rowsById(ctx);
  let monthly = 0;
  for (const s of ctx.recurring) {
    if (s.cadence === null || s.kind === "income" || s.firstDate >= start) continue;
    const ids = new Set(s.transactionIds);
    // a charge far from the price the series had before the change is no charge at its cadence: the detector may read
    // a yearly fee after monthly ones as a price change of the same series
    const old = median(
      s.transactionIds
        .map((id) => byId.get(id))
        .filter((t): t is AnalysisTx => t !== undefined && t.bookingDate < start)
        .map(netCost),
    );
    const own = rows.filter((t) => ids.has(t.id) && Math.abs(netCost(t) - old) <= SAME_PRICE * old);
    for (const t of own) covered.add(t.id);
    // at the series' own charges a month, the count `beforeCost` uses: an unchanged fee with a free July is no rise
    if (own.some((t) => monthOf(t.bookingDate) > changeover)) monthly += median(own.map(netCost)) * s.perMonth;
  }
  const fresh = detectRecurring(
    rows.filter((t) => !covered.has(t.id)),
    end,
  ).filter((s) => s.cadence !== null && s.kind !== "income");
  for (const s of fresh) {
    monthly += s.monthlyCents;
    for (const id of s.transactionIds) covered.add(id);
  }
  return { monthly: Math.round(monthly), loose: rows.filter((t) => !covered.has(t.id)).length };
}

/**
 * Cost per month of a contract before the change: the series its charges of the two years before form, by their
 * cadence. Charges no series holds fall back on the finding's own count of charges a year.
 */
function beforeCost(rows: readonly AnalysisTx[], start: IsoDate, perYear: number): number | null {
  if (!rows.length) return null;
  const series = detectRecurring(rows, addDays(start, -1)).filter((s) => s.cadence !== null && s.kind !== "income");
  if (series.length) return series.reduce((sum, s) => sum + s.monthlyCents, 0);
  return Math.round((median(rows.map(netCost)) * perYear) / 12);
}

/** The CPI change of a month, or of the latest month before it within the publication lag. */
function cpiFor(month: string, today: IsoDate): number | null {
  for (let i = 0; i <= CPI_LAG_MONTHS; i++) {
    const value = cpiChange(addMonths(month, -i), today);
    if (value !== null) return value;
  }
  return null;
}

interface Prepared {
  /** A verdict that no month changes: nothing to measure. */
  fixed?: FindingOutcome;
  judge: (last: string) => FindingOutcome;
}

const unmeasurable: FindingOutcome = { verdict: "epäselvä", monthlyCents: null, reason: "Tätä muutosta ei voi mitata tapahtumista." };

/** Monthly sums and charges of the measure, read once, so the line can judge the same decision at several months. */
function prepare(ctx: AnalysisContext, state: FindingState, finding: FollowedFinding | null): Prepared {
  const measure = measureOf(ctx, state.findingId, finding);
  const effective = state.effectiveDate ?? state.decidedAt.slice(0, 10);
  if (!measure || measure.kind === "none") return { fixed: unmeasurable, judge: () => unmeasurable };

  const switched = switchOf(ctx, measure);
  const replacement = switched ? { merchant: switched.to.merchant, date: switched.to.firstDate, text: `Korvaava palvelu alkoi: ${switched.to.merchant}` } : undefined;
  const matches = matcherOf(ctx, measure, replacement?.merchant ?? null);
  const changeover = monthOf(effective);
  const sums = new Map<string, number>();
  const paid: AnalysisTx[] = [];
  const evidence = new Set<string>();
  const lastBooking = new Map<string, IsoDate>();
  for (const t of ctx.txs) {
    if (!lastBooking.has(t.accountId) || t.bookingDate > lastBooking.get(t.accountId)!) lastBooking.set(t.accountId, t.bookingDate);
    if (!matches(t)) continue;
    const m = monthOf(t.bookingDate);
    const cost = netCost(t);
    sums.set(m, (sums.get(m) ?? 0) + cost);
    if (cost > 0) paid.push(t);
    // the accounts the baseline stands on; one closed long before it has no say on the months after
    if (m < changeover && m >= addMonths(changeover, -BEFORE_MONTHS)) evidence.add(t.accountId);
  }
  const sumOf = (m: string) => sums.get(m) ?? 0;
  const expected = state.midCents !== null && state.midCents > 0 ? state.midCents / 12 : null;
  const perYear = measure.perYear ?? 12;
  const cycle = perYear >= 12 ? 1 : Math.max(1, Math.round(12 / perYear));
  const wait = cycle === 1 ? MONTHLY_WAIT : cycle;
  // a contract bills at a cadence, so it is compared by cost per month; spending at a shop or in a category by months
  const contract = measure.kind === "series" || (measure.kind === "merchants" && measure.perYear !== undefined);
  const series = seriesOf(ctx, measure);
  // only a cancellation is expected to stop the payment; a renegotiated loan or a new electricity price keeps billing
  const cancels = finding?.action?.toLocaleLowerCase("fi").startsWith("irtisano") ?? false;
  const stillBilling = cancels && series.length > 0 && series.every((s) => s.active && monthOf(s.lastDate) > changeover) ? series[0]! : null;

  const withReplacement = (o: FindingOutcome): FindingOutcome => {
    const named = replacement ? { ...o, replacement, reason: `${o.reason} ${replacement.merchant} on laskettu mukaan.` } : o;
    // a cancelled payment that still bills says so when the figures show no saving
    if ((named.verdict === "epäselvä" || named.verdict === "huonompi") && stillBilling && named.monthlyCents !== null) {
      return { ...named, reason: `${named.reason} ${stillBilling.merchant}: maksuja tulee yhä, viimeksi ${formatFiDate(stillBilling.lastDate)}.` };
    }
    return named;
  };

  /** Rules shared by every kind: the size of the effect against the mid, and the gate for worse. */
  const verdictOf = (effect: number, allBelow: boolean): Verdict => {
    if (expected !== null) {
      if (effect >= CONFIRMED_SHARE * expected && allBelow) return "vahvistui";
      if (effect >= LIKELY_SHARE * expected && effect > 0) return "todennäköinen";
    } else if (effect >= ITEM_GATE_MONTHLY_CENTS && allBelow) {
      // without the mid the size cannot be checked against what was found, so the data never confirms it
      return "todennäköinen";
    }
    return -effect >= ITEM_GATE_MONTHLY_CENTS ? "huonompi" : "epäselvä";
  };

  const judge = (last: string): FindingOutcome => {
    const after = last > changeover ? monthRange(addMonths(changeover, 1), last).filter((m) => isCompleteMonth(ctx, m)) : [];
    const ready = `${addMonths(changeover, wait + 1)}-01`;
    const waiting = (reason = `Tulos lasketaan, kun muutoksen jälkeen on ${wait} täyttä kuukautta: ${formatFiDate(ready)}.`): FindingOutcome => ({ verdict: "odottaa", monthlyCents: null, reason });
    if (after.length < wait) return waiting();
    // an account that stopped syncing would read as a saving: its rows must reach the last month judged
    const lastMonth = after[after.length - 1]!;
    for (const account of evidence) {
      const seen = lastBooking.get(account)!;
      if (seen < `${lastMonth}-01`) {
        const name = ctx.accounts.find((a) => a.id === account)?.name ?? account;
        return { verdict: "epäselvä", monthlyCents: null, reason: `Tilin ${name} tapahtumia ei ole haettu ${formatFiDate(seen)} jälkeen.` };
      }
    }

    if (measure.kind === "season" || measure.kind === "unit") {
      if (after.some((m) => !isCompleteMonth(ctx, addMonths(m, -12)))) return { verdict: "epäselvä", monthlyCents: null, reason: "Vertailuun tarvitaan samat kuukaudet vuotta aiemmin." };
      // the months of the season: a month without spending in either year says nothing about the change
      const months = after.filter((m) => sumOf(m) > 0 || sumOf(addMonths(m, -12)) > 0).slice(-BEFORE_MONTHS);
      if (!months.length) return { verdict: "epäselvä", monthlyCents: null, reason: "Samoina kuukausina vuotta aiemmin ei ole menoja vertailuun." };
      let note: string;
      let factor: (m: string) => number;
      if (measure.kind === "season") {
        const cpi = months.map((m) => cpiFor(m, ctx.today));
        if (cpi.some((c) => c === null)) return { verdict: "epäselvä", monthlyCents: null, reason: "Vertailutieto on vanhentunut." };
        const byMonth = new Map(months.map((m, i) => [m, 1 + cpi[i]! / 100]));
        factor = (m) => byMonth.get(m)!;
        note = "Vuoden takaiset summat on korjattu kuluttajahintojen muutoksella.";
      } else {
        // the old kWh is not stored, so no price per kWh can be told: the bills are compared as they are
        factor = () => 1;
        note = "Vertailussa ovat laskujen summat, joten kulutuksen muutos näkyy luvussa.";
      }
      const diffs = months.map((m) => sumOf(addMonths(m, -12)) * factor(m) - sumOf(m));
      const effect = Math.round(median(diffs));
      let verdict = verdictOf(effect, diffs.every((d) => d > 0));
      // a lower bill may be a milder year: the bills alone never confirm a cheaper price
      if (measure.kind === "unit" && verdict === "vahvistui") verdict = "todennäköinen";
      return withReplacement({ verdict, monthlyCents: effect, reason: `${difference(effect)} verrattuna samoihin ${months.length} kuukauteen vuotta aiemmin. ${note}` });
    }

    if (!contract) {
      let before = completeMonthsBefore(ctx, changeover, BEFORE_MONTHS).map(sumOf);
      if (before.length < MIN_BEFORE_MONTHS && (state.baseline?.length ?? 0) >= MIN_BEFORE_MONTHS) before = state.baseline!.map((b) => b.cents);
      if (before.length < MIN_BEFORE_MONTHS) return { verdict: "epäselvä", monthlyCents: null, reason: `Ennen muutosta on alle ${MIN_BEFORE_MONTHS} täyttä kuukautta vertailuun.` };
      const b = median(before);
      // a payment that covers months ahead (a yearly fee instead of monthly ones) in the changeover month would leave
      // the months after empty and read as a saving
      if (paysAhead(sumOf(changeover), Math.max(b, ITEM_GATE_MONTHLY_CENTS))) return waiting("Uuden maksun laskutusväli ei vielä näy.");
      const xs = after.slice(-BEFORE_MONTHS).map(sumOf);
      const a = median(xs);
      const effect = Math.round(b - a);
      return withReplacement({
        verdict: verdictOf(effect, xs.every((x) => x < b)),
        monthlyCents: effect,
        reason: `${difference(effect)}: tavallisesti ${eur(a)} kuussa ${xs.length} kuukauden ajan muutoksen jälkeen ja ${eur(b)} ennen sitä.`,
      });
    }

    // a contract: cost per month by cadence on both sides, so a quarterly bill, a yearly one or a new payee's count
    // for what they are; the changeover month counts for the time after
    const start = `${changeover}-01`;
    const end = monthEnd(lastMonth);
    const before = beforeCost(
      paid.filter((t) => t.bookingDate < start && t.bookingDate >= `${addMonths(changeover, -2 * BEFORE_MONTHS)}-01` && t.merchant !== replacement?.merchant),
      start,
      perYear,
    );
    if (before === null) return { verdict: "epäselvä", monthlyCents: null, reason: "Ennen muutosta ei ole maksuja vertailuun." };
    const afterRows = paid.filter((t) => t.bookingDate >= start && t.bookingDate <= end);
    const now = afterCost(ctx, afterRows, start, end, changeover);
    if (now.loose) return waiting("Uuden maksun laskutusväli ei vielä näy.");
    // no charge yet: the next one may be days late, so a stop is read only a month past the cycle and when no series runs
    if (now.monthly === 0 && (after.length < cycle + 1 || series.some((s) => s.active))) return waiting("Seuraava maksu ei ole vielä näkynyt.");
    const effect = before - now.monthly;
    const reason = now.monthly
      ? `${difference(effect)}: maksut ${eur(now.monthly)} kuussa muutoksen jälkeen ja ${eur(before)} ennen sitä.`
      : `${difference(effect)}: muutoksen jälkeen ei maksuja ${after.length} kuukauteen, ennen ${eur(before)} kuussa.`;
    return withReplacement({ verdict: verdictOf(effect, now.monthly < before), monthlyCents: effect, reason });
  };
  return { judge };
}

/** The last complete month before today's, or null when the history covers none. */
function lastComplete(ctx: AnalysisContext): string | null {
  const month = addMonths(monthOf(ctx.today), -1);
  return isCompleteMonth(ctx, month) ? month : null;
}

/**
 * What came of a done decision: by `measure.kind`, a contract (a series, or merchants with charges a year) by its cost
 * per month normalised by cadence before and after; spending at merchants or in a category by medians of complete
 * months; a season against the same months a year earlier deflated by CPI; the unit's bills against the same months a
 * year earlier, never above todennäköinen.
 */
export function outcomeOf(ctx: AnalysisContext, state: FindingState, finding: FollowedFinding | null): FindingOutcome {
  const prepared = prepare(ctx, state, finding);
  if (prepared.fixed) return prepared.fixed;
  return prepared.judge(lastComplete(ctx) ?? addMonths(monthOf(ctx.today), -1));
}

/**
 * An active finding whose change the data shows: every payment of its measure stopped and a new payee in the category
 * took over (the switch test of the stopped insight). The page asks to confirm; nothing here stores a decision.
 */
export function proposalOf(ctx: AnalysisContext, finding: Pick<Finding, "id" | "measure">): SwitchProposal | null {
  const switched = switchOf(ctx, finding.measure);
  if (!switched || switched.to.firstDate < addDays(ctx.today, -PROPOSAL_DAYS)) return null;
  const what = switched.from.category === "subscriptions" ? "tilauksen" : "sopimuksen";
  return { findingId: finding.id, date: switched.to.firstDate, text: `Näyttää siltä, että vaihdoit ${what} ${formatFiDate(switched.to.firstDate)}. Vahvista.` };
}

/**
 * The follow-up of the page: the outcome of every done decision, the switches the data shows, and per snapshot month
 * the euros a year found (mid of the findings not dismissed and not matala) against the euros a year confirmed by then
 * (12 times the monthly effect of each decision judged vahvistui with the months up to the one before).
 */
export function followUpOf(ctx: AnalysisContext, data: OptimiseData, snapshots: readonly Snapshot[]): FollowUp {
  const prepared = data.done.map(({ state, finding }) => ({ state, prepared: prepare(ctx, state, finding) }));
  const last = lastComplete(ctx) ?? addMonths(monthOf(ctx.today), -1);
  const outcomes = prepared.map(({ state, prepared: p }) => ({ findingId: state.findingId, outcome: p.fixed ?? p.judge(last) }));
  const proposals = shownFindings(data).flatMap((f) => proposalOf(ctx, f) ?? []);
  const line = [...snapshots]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-LINE_MONTHS)
    .map(({ month, entries }) => {
      const upTo = addMonths(month, -1) < last ? addMonths(month, -1) : last;
      const foundCents = entries.reduce((sum, e) => sum + (e.status !== "dismissed" && e.certainty !== "matala" ? (e.midCents ?? 0) : 0), 0);
      const confirmedCents = prepared.reduce((sum, { prepared: p }) => {
        if (p.fixed) return sum;
        const o = p.judge(upTo);
        return sum + (o.verdict === "vahvistui" && o.monthlyCents !== null ? o.monthlyCents * 12 : 0);
      }, 0);
      return { month, foundCents, confirmedCents };
    });
  return { outcomes, proposals, line };
}
