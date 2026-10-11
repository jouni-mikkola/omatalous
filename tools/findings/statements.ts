/**
 * Every statement the product makes about money, as stable text: what the overview and Havainnot say (insights,
 * alerts), Optimoi's findings and their follow-up, Mikä muuttui (income) and the spending change sentences. One block
 * per statement with its number and its calc, so a reviewer reads a change in what the product says as a text diff.
 */
import { buildAlerts } from "../../packages/core/src/analysis/alerts.ts";
import type { AnalysisContext } from "../../packages/core/src/analysis/context.ts";
import { incomeBase, incomeChanges } from "../../packages/core/src/analysis/income-changes.ts";
import type { DateRange } from "../../packages/core/src/analysis/period.ts";
import { addMonths, monthOf } from "../../packages/core/src/dates.ts";
import { allFindings, buildOptimise } from "../../packages/core/src/optimise/index.ts";
import { outcomeOf } from "../../packages/core/src/optimise/outcome.ts";
import { baselineOf } from "../../packages/core/src/optimise/state.ts";
import type { Finding, FindingState } from "../../packages/core/src/optimise/types.ts";
import { insightsReport } from "../../packages/core/src/reports/insights.ts";
import { spendingChangeReport } from "../../packages/core/src/reports/spending-change.ts";
import { contextOf, type Household } from "./households.ts";

export const SOURCE_IDS = ["insights", "alerts", "optimise", "income", "change", "outcome"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export interface Statement {
  source: SourceId;
  household: string;
  /** The product's own id: an insight, alert, finding or income change id; `change:<view>:<months>` and `outcome:<finding id>` here. */
  id: string;
  /** The detector that made it: an insight's id prefix, an alert's kind, `<area>:<kind>`, an income change kind, a change view. */
  kind: string;
  title: string;
  /** The number it stands on, "" when it has none (an alert). */
  figure: string;
  calc: string[];
  /** Rows behind it; null when the source names none. */
  rows: number | null;
  /** It says something moved or is worth acting on. A change sentence under its gate and a follow-up that waits are quiet. */
  loud: boolean;
}

/** Finnish formatting puts no-break spaces in numbers; a golden file reads better and diffs the same with plain ones. */
const plain = (s: string) => s.replace(/[  ]/g, " ");
const eur = (cents: number) => `${cents < 0 ? "-" : ""}${(Math.abs(cents) / 100).toFixed(2)} €`;

/** The period the overview opens on: the running month up to today (`parseRange` without a query). */
export function monthToDate(today: string): DateRange {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** The day the follow-up pretends each finding was marked done: the first day of the fourth month before today's. */
export function doneOn(today: string): string {
  return `${addMonths(monthOf(today), -4)}-01`;
}

interface Run {
  h: Household;
  ctx: AnalysisContext;
  range: DateRange;
  findings: () => Finding[];
}

type Maker = (r: Run) => Omit<Statement, "source" | "household">[];

const MAKERS: Record<SourceId, Maker> = {
  insights: ({ h, ctx, range }) =>
    insightsReport(ctx, range, h.inputs).items.map((i) => ({
      id: i.id,
      kind: i.id.split(":")[0]!,
      title: i.title,
      figure: `${i.direction === -1 ? "-" : ""}${eur(i.yearlyCents)} a year`,
      calc: [i.detail, `tone ${i.tone}`],
      rows: i.rows?.length ?? 0,
      loud: true,
    })),
  alerts: ({ h, ctx, range }) =>
    buildAlerts(ctx, range, h.inputs).map((a) => ({ id: a.id, kind: a.kind, title: a.title, figure: "", calc: [a.detail, `tone ${a.tone}`], rows: null, loud: true })),
  optimise: ({ findings }) =>
    findings().map((f) => ({
      id: f.id,
      kind: `${f.area}:${f.kind}`,
      title: f.title,
      figure: f.euros ? `${eur(f.euros.lowCents)} / ${eur(f.euros.midCents)} / ${eur(f.euros.highCents)} a year` : `decide by ${f.decideBy}`,
      calc: [`certainty ${f.certainty.level}: ${f.certainty.reason}`, ...f.calc.map((c) => `${c.label}: ${c.value}${c.struck ? " (struck)" : ""}`), `action ${f.action}`],
      rows: f.rows.length,
      loud: true,
    })),
  income: ({ ctx, range }) => {
    const end = range.to < ctx.today ? range.to : ctx.today;
    return incomeChanges(incomeBase(ctx, end), end === ctx.today).map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      figure: `${eur(c.monthlyCents)} a month, ${eur(c.yearlyCents)} a year`,
      calc: [c.detail, ...(c.payer ? [`payer ${c.payer}`] : [])],
      rows: c.txIds.length,
      loud: true,
    }));
  },
  change: ({ ctx, range }) =>
    spendingChangeReport(ctx, range).views.map(({ view, sentence, bars, change: c }) => ({
      id: `change:${view}:${c.target.months[0]}..${c.target.months[c.target.months.length - 1]}`,
      kind: view,
      title: sentence,
      figure: `${eur(c.changeCents)} (now ${eur(c.nowCents)}, base ${eur(c.baseCents)}, gate ${eur(c.gateCents)})`,
      calc: bars.map((b) => `${b.label}: ${eur(b.cents)}${b.cause ? ` (${b.cause})` : ""}${b.season ? " season" : ""}`),
      rows: null,
      loud: Math.abs(c.changeCents) >= c.gateCents,
    })),
  outcome: ({ ctx, findings }) => {
    const on = doneOn(ctx.today);
    return findings()
      .filter((f) => f.measure.kind !== "none")
      .map((f) => {
        const state: FindingState = { findingId: f.id, status: "done", reason: null, until: null, effectiveDate: on, midCents: f.euros?.midCents ?? null, baseline: baselineOf(ctx, f, on), decidedAt: `${on}T12:00:00Z` };
        const o = outcomeOf(ctx, state, f);
        return {
          id: `outcome:${f.id}`,
          kind: o.verdict,
          title: o.reason,
          figure: o.monthlyCents === null ? "" : `${eur(o.monthlyCents)} a month`,
          calc: [`verdict ${o.verdict}, done on ${on}`, ...(o.replacement ? [o.replacement.text] : [])],
          rows: null,
          loud: o.verdict !== "odottaa" && o.verdict !== "epäselvä",
        };
      });
  },
};

/** Every statement of the given sources about one household, sorted by source and id. */
export function statements(h: Household, sources: readonly SourceId[] = SOURCE_IDS): Statement[] {
  const ctx = contextOf(h);
  let found: Finding[] | null = null;
  const run: Run = {
    h,
    ctx,
    range: monthToDate(h.today),
    findings: () => (found ??= allFindings(buildOptimise({ ctx, balances: h.balances, inputs: h.inputs, values: h.values, industry: h.industry }))),
  };
  return SOURCE_IDS.filter((s) => sources.includes(s)).flatMap((source) =>
    MAKERS[source](run)
      .map((s) => ({ source, household: h.name, ...s, title: plain(s.title), figure: plain(s.figure), calc: s.calc.map(plain) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

/** One block: a header line, then the title, the figure, each calc line and the row count, indented. */
export function formatStatement(s: Statement): string {
  const lines = [`${s.source} · ${s.household} · ${s.id}${s.loud ? "" : " (quiet)"}`, `  ${s.title}`];
  if (s.figure) lines.push(`  = ${s.figure}`);
  for (const c of s.calc) lines.push(`  | ${c}`);
  if (s.rows !== null) lines.push(`  rows ${s.rows}`);
  return lines.join("\n");
}

export function formatStatements(list: readonly Statement[]): string {
  return list.map(formatStatement).join("\n\n");
}
