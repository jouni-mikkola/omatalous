import { flagLoanPayment } from "../loan-payment.ts";
/**
 * Optimoi: the household's decisions with a price or a deadline. Each area (`areas/*.ts`) returns its findings and what
 * it checked; this frame applies the rules every finding follows: complete months only, the gate, certainty from
 * weaknesses, the user's states, every finding of an area, the order of areas and the headline without overlaps. The
 * insights no finding covers come along as Muut havainnot (`others.ts`). Pure: `ctx.today` is the only clock.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import { unknownSpending } from "../analysis/data-quality.ts";
import { completeMonthsBefore } from "../analysis/usual.ts";
import { addDays, addMonths, monthEnd, monthOf } from "../dates.ts";
import { type BalanceInput, type IsoDate, NO_INPUTS, type UserInputs } from "../types.ts";
import { bank } from "./areas/bank.ts";
import { car } from "./areas/car.ts";
import { electricity } from "./areas/electricity.ts";
import { food } from "./areas/food.ts";
import { habits } from "./areas/habits.ts";
import { housing } from "./areas/housing.ts";
import { insurance } from "./areas/insurance.ts";
import { kids } from "./areas/kids.ts";
import { loans } from "./areas/loans.ts";
import { savings } from "./areas/savings.ts";
import { seasons } from "./areas/seasons.ts";
import { subscriptions } from "./areas/subscriptions.ts";
import { tax } from "./areas/tax.ts";
import {
  CERTAINTY_WEIGHT,
  certaintyOf,
  evidenceWeakness,
  GATE_YEARLY_CENTS,
  householdWeakness,
  MAX_ROWS,
  qualityOf,
  shortHistoryWeakness,
  sortWeaknesses,
  WIDE_RANGE,
  WHY_FACTS,
  WHY_OTHER,
  whyHistory,
  yearWindow,
} from "./common.ts";
import { factOn } from "./facts/index.ts";
import { inputDefOf, inputStatus } from "./inputs.ts";
import { othersOf } from "./others.ts";
import { situationOf } from "./situation.ts";
import { headlineOf, reachOf } from "./headline.ts";
import { placeOf } from "./state.ts";
import type { Area, AreaInput, AreaView, Check, Finding, FindingDraft, FindingState, InputValues, NeededInput, OptimiseData } from "./types.ts";

export * from "./common.ts";
export * from "./facts/index.ts";
export * from "./headline.ts";
export * from "./inputs.ts";
export * from "./others.ts";
export * from "./rates.ts";
export * from "./situation.ts";
export * from "./state.ts";
export * from "./types.ts";

/** Every area, in the order a tie between two areas keeps. To add one, add a line here. */
export const AREAS: readonly Area[] = [loans, savings, subscriptions, bank, electricity, housing, insurance, food, habits, seasons, tax, kids, car];

/** A finding with `decideBy` this many days ahead or fewer lands in Seuraavat 60 päivää. */
export const SOON_DAYS = 60;
/** Rule 2: under this many complete months only deadlines... */
export const MIN_MONTHS_ANY = 3;
/** ...and under this many no euro figure. */
export const MIN_MONTHS_EUROS = 6;

/** What the server hands in: the cached context and what the user typed, read per request. */
export interface OptimiseInput {
  ctx: AnalysisContext;
  balances: readonly BalanceInput[];
  inputs?: UserInputs;
  values?: InputValues;
  states?: readonly FindingState[];
  /** Merchant name to TOL code from the user's own register lookups. */
  industry?: ReadonlyMap<string, string>;
  /** The areas to run; tests pass their own. */
  areas?: readonly Area[];
}

/** The last day of the last complete month: the month before today's. */
export function optimiseEnd(today: IsoDate): IsoDate {
  return monthEnd(addMonths(monthOf(today), -1));
}

/** What every area gets. Exported so an area's own tests can call `assess` directly. */
export function areaInputOf(input: OptimiseInput): AreaInput {
  const { ctx } = input;
  const end = optimiseEnd(ctx.today);
  const window = yearWindow(ctx, end);
  return {
    ctx,
    today: ctx.today,
    end,
    months: window.months,
    balances: flagLoanPayment(ctx, input.balances),
    inputs: input.inputs ?? NO_INPUTS,
    values: input.values ?? {},
    industry: input.industry ?? new Map(),
    quality: qualityOf(ctx, { from: window.from ?? end, to: end }, input.balances),
  };
}

type Dropped = "history" | "facts" | "gate";

/** The complete months the frame asks of a draft with a euro figure, and of one without. */
const needOf = (draft: FindingDraft): number => (draft.euros !== null ? MIN_MONTHS_EUROS : MIN_MONTHS_ANY);

/** Rules 2, 3, 4 and 7 on one draft: the finding as shown, or why it is not. */
function settle(draft: FindingDraft, a: AreaInput): Finding | Dropped {
  const months = a.months.length;
  const deadline = draft.euros === null && draft.decideBy !== null;
  if (months < MIN_MONTHS_ANY && !deadline) return "history";
  if (months < MIN_MONTHS_EUROS && draft.euros !== null) return "history";
  // an expired or only proposed fact leaves the comparison without a basis today (rule 1); areas check too, this is the net
  if (draft.facts.some((id) => !factOn(id, a.today))) return "facts";
  if (draft.euros && draft.euros.midCents < GATE_YEARLY_CENTS) return "gate";
  const rows = draft.rows.slice(-MAX_ROWS);
  const kept = new Set(rows);
  const weaknesses = [...draft.weaknesses];
  if (draft.euros && months < 12 && !weaknesses.some((w) => w.id === "short_history")) weaknesses.push(shortHistoryWeakness(months));
  weaknesses.push(...evidenceWeakness(a.ctx, rows, a.quality));
  if (draft.euros && draft.euros.highCents - draft.euros.lowCents > draft.euros.midCents) weaknesses.push(WIDE_RANGE);
  const sorted = sortWeaknesses(weaknesses);
  return { ...draft, rows, struck: draft.struck.filter((id) => kept.has(id)), weaknesses: sorted, certainty: certaintyOf(sorted) };
}

const weightOf = (f: Finding) => (f.euros ? f.euros.midCents * CERTAINTY_WEIGHT[f.certainty.level] : 0);

/** Korkea and keskitaso before matala; euros by weighted mid, then deadlines soonest first. */
function byRank(a: Finding, b: Finding): number {
  const matala = Number(a.certainty.level === "matala") - Number(b.certainty.level === "matala");
  if (matala) return matala;
  const euros = Number(!a.euros) - Number(!b.euros);
  if (euros) return euros;
  return weightOf(b) - weightOf(a) || (a.decideBy ?? "").localeCompare(b.decideBy ?? "") || a.id.localeCompare(b.id);
}

/** Every finding of the result once: shown, done or dismissed. The evidence route looks an id up here. */
export function allFindings(data: Pick<OptimiseData, "areas" | "soon" | "done" | "dismissed">): Finding[] {
  const out = new Map<string, Finding>();
  for (const f of [...data.areas.flatMap((a) => a.findings), ...data.soon, ...data.done.map((d) => d.finding), ...data.dismissed.map((d) => d.finding)]) {
    if (f && !out.has(f.id)) out.set(f.id, f);
  }
  return [...out.values()];
}

export function buildOptimise(input: OptimiseInput): OptimiseData {
  const { ctx } = input;
  const today = ctx.today;
  const a = areaInputOf(input);
  const states = new Map((input.states ?? []).map((s) => [s.findingId, s]));
  const areas = input.areas ?? AREAS;
  const order = new Map(areas.map((area, i) => [area.id, i]));
  const active: Finding[] = [];
  const done: OptimiseData["done"] = [];
  const dismissed: OptimiseData["dismissed"] = [];
  const snoozed: OptimiseData["snoozed"] = [];
  const views: AreaView[] = [];
  // the rows of every finding the page knows, shown or decided: an insight about the same rows is left to it
  const findingRows: (readonly string[])[] = [];

  for (const area of areas) {
    const result = area.assess(a);
    const shown: Finding[] = [];
    const dropped = new Map<string, Dropped>();
    const need = new Map<string, number>();
    const snoozedKinds = new Set<string>();
    const seen = new Set<string>();
    for (const draft of result.findings) {
      // an area reports only its own findings, each once
      if (draft.area !== area.id || seen.has(draft.id)) continue;
      seen.add(draft.id);
      const settled = settle(draft, a);
      if (typeof settled === "string") {
        // the check then reads "clear" when only the gate stopped it, "no_data" when the data could not tell
        dropped.set(draft.kind, settled === "gate" ? (dropped.get(draft.kind) ?? "gate") : settled);
        need.set(draft.kind, Math.max(need.get(draft.kind) ?? 0, needOf(draft)));
        continue;
      }
      findingRows.push(draft.rows);
      const state = states.get(settled.id);
      const place = placeOf(state, settled, today);
      if (place === "done") done.push({ state: state!, finding: settled });
      else if (place === "dismissed") dismissed.push({ state: state!, finding: settled });
      else if (place === "snoozed") {
        snoozedKinds.add(settled.kind);
        snoozed.push({ state: state!, finding: settled });
      } else shown.push(place === "reopened" ? { ...settled, reopened: true } : settled);
    }
    // a decided or snoozed finding was still found: its check says so
    const kinds = new Set([...shown.map((f) => f.kind), ...snoozedKinds]);
    const decided = new Set([...done, ...dismissed].filter((d) => d.finding?.area === area.id).map((d) => d.finding!.kind));
    const checks: Check[] = result.checks.map((c): Check => {
      const kind = c.id.slice(c.id.indexOf(":") + 1);
      if (kinds.has(kind) || decided.has(kind)) return { ...c, status: "finding" };
      const why = dropped.get(kind);
      if (why === "history") return c.status === "clear" || c.status === "finding" ? { ...c, status: "no_data", why: whyHistory(a, need.get(kind)!) } : c;
      if (why === "facts") return c.status === "clear" || c.status === "finding" ? { ...c, status: "no_data", why: WHY_FACTS } : c;
      return c.status === "finding" ? { ...c, status: "clear" } : c;
    }).map((c) => (c.status === "no_data" && !c.why ? { ...c, why: WHY_OTHER } : c));
    shown.sort(byRank);
    active.push(...shown);
    views.push({
      id: area.id,
      label: area.label,
      findings: shown,
      checks,
      ...(result.summary ? { summary: result.summary } : {}),
      weightCents: Math.round(shown.reduce((s, f) => s + weightOf(f), 0)),
    });
  }

  // a done decision stays in Päätetyt after its finding stops showing in the data: that is what the change was for
  const doneIds = new Set(done.map((d) => d.state.findingId));
  for (const s of input.states ?? []) if (s.status === "done" && !doneIds.has(s.findingId)) done.push({ state: s, finding: null });
  // a reminder is listed until its day, with its finding while the data still shows it
  const snoozedIds = new Set(snoozed.map((d) => d.state.findingId));
  for (const s of input.states ?? []) if (placeOf(s, { euros: null }, today) === "snoozed" && !snoozedIds.has(s.findingId)) snoozed.push({ state: s, finding: null });

  views.sort((x, y) => y.weightCents - x.weightCents || Number(!x.findings.length) - Number(!y.findings.length) || order.get(x.id)! - order.get(y.id)!);
  const until = addDays(today, SOON_DAYS);
  const soon = active
    .filter((f) => f.certainty.level !== "matala" && f.decideBy !== null && f.decideBy >= today && f.decideBy <= until)
    .sort((x, y) => x.decideBy!.localeCompare(y.decideBy!) || x.id.localeCompare(y.id));
  const checks = views.flatMap((v) => v.checks);

  return {
    today,
    end: a.end,
    months: a.months.length,
    historyMonths: completeMonthsBefore(ctx, monthOf(today), 1200).length,
    dataTo: ctx.txs.length ? ctx.txs[ctx.txs.length - 1]!.bookingDate : null,
    accounts: ctx.accounts.length,
    situation: situationOf(ctx, a.months, input.balances, a.inputs),
    headline: headlineOf(active),
    household: householdWeakness(a.quality),
    areas: views,
    reach: reachOf(ctx, views, a.months),
    soon,
    done,
    dismissed,
    snoozed,
    unknownShare: unknownSpending(ctx, { from: a.months.length ? `${a.months[0]}-01` : a.end, to: a.end }).share,
    ...othersOf(a, findingRows),
    needed: neededOf(views, a.values, today),
    checked: {
      total: checks.length,
      findings: active.length,
      unavailable: checks.filter((c) => c.status === "needs_input" || c.status === "no_data").length,
      noRows: checks.filter((c) => c.status === "no_rows").length,
      noSubject: checks.filter((c) => c.status === "no_subject").length,
    },
  };
}

/** The inputs the checks wait for and the findings would sharpen with, once each, with the stale value if any. */
function neededOf(views: readonly AreaView[], values: InputValues, today: IsoDate): NeededInput[] {
  const out = new Map<string, NeededInput>();
  const add = (key: string) => {
    const found = inputDefOf(key);
    if (!found || out.has(key)) return;
    const status = inputStatus(values, key, today);
    if (status.state === "ok") return;
    out.set(key, { key, def: found.def.key, subject: found.subject, old: status.state === "stale" ? status.stored : null });
  };
  for (const v of views) {
    for (const c of v.checks) if (c.status === "needs_input" && c.input) add(c.input);
    for (const f of v.findings) for (const key of f.needs ?? []) add(key);
  }
  return [...out.values()];
}
