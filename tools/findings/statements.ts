/**
 * Every statement the product makes about money, as stable text: what Säästövinkit says as Muut havainnot (insights,
 * alerts), Mikä muuttui (income) and the spending change sentences. One block
 * per statement with its number and its calc, so a reviewer reads a change in what the product says as a text diff.
 * Last, the rows the product holds apart as large (`large`), what goes where by theme over the last twelve complete
 * months (`themes`) and the behaviour signals of BA1 (`behaviour`: credit stacking, the payday effect, split bill
 * questions): no sentence of a page yet, so every one of them is quiet.
 */
import { buildAlerts } from "../../packages/core/src/analysis/alerts.ts";
import { type AnalysisContext, netSpend } from "../../packages/core/src/analysis/context.ts";
import { incomeBase, incomeChanges } from "../../packages/core/src/analysis/income-changes.ts";
import { insightInputOf, rankInsights } from "../../packages/core/src/analysis/insights/index.ts";
import { largeIncome, largePurchases } from "../../packages/core/src/analysis/large.ts";
import type { DateRange } from "../../packages/core/src/analysis/period.ts";
import { themesReport } from "../../packages/core/src/analysis/themes-report.ts";
import { insightText } from "../../packages/core/src/explain/insights.ts";
import { creditStack } from "../../packages/core/src/behaviour/credit-stack.ts";
import { paydayEffect } from "../../packages/core/src/behaviour/payday.ts";
import { splitCandidates } from "../../packages/core/src/behaviour/split.ts";
import { spendingChangeReport } from "../../packages/core/src/reports/spending-change.ts";
import { contextOf, type Household } from "./households.ts";

export const SOURCE_IDS = ["insights", "alerts", "income", "change", "large", "themes", "behaviour"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export interface Statement {
  source: SourceId;
  household: string;
  /**
   * The product's own id: an insight, alert, finding or income change id; `change:<view>:<months>`, `outcome:<finding id>`,
   * `large:<day>:<row id>`, `themes:<theme id>`, `themes:window`, `behaviour:credit`, `behaviour:payday` and
   * `behaviour:split:<purchase id>` here.
   */
  id: string;
  /** The detector that made it: an insight's id prefix, an alert's kind, `<area>:<kind>`, an income change kind, a change view; `theme`, `window` or `none` of the themes. */
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

interface Run {
  h: Household;
  ctx: AnalysisContext;
  range: DateRange;
}

type Maker = (r: Run) => Omit<Statement, "source" | "household">[];

const MAKERS: Record<SourceId, Maker> = {
  insights: ({ h, ctx, range }) =>
    rankInsights(insightInputOf(ctx, range, h.inputs)).map((i) => {
      const text = insightText(i);
      return {
        id: i.id,
        kind: i.id.split(":")[0]!,
        title: text.title,
        figure: `${(i.effectPerYear?.cents ?? 0) < 0 ? "-" : ""}${eur(Math.abs(i.effectPerYear?.cents ?? 0))} a year`,
        calc: [text.detail, `tone ${text.tone}`, `${i.kind} ${i.action.label}`],
        rows: i.evidence.rows.length,
        loud: true,
      };
    }),
  alerts: ({ h, ctx, range }) =>
    buildAlerts(ctx, range, h.inputs).map((a) => ({ id: a.id, kind: a.kind, title: a.title, figure: "", calc: [a.detail, `tone ${a.tone}`], rows: null, loud: true })),
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
    spendingChangeReport(ctx, range).views.map(({ view, sentence, quiet, bars, change: c }) => ({
      id: `change:${view}:${c.target.months[0]}..${c.target.months[c.target.months.length - 1]}`,
      kind: view,
      title: sentence,
      figure: `${eur(c.changeCents)} (now ${eur(c.nowCents)}, base ${eur(c.baseCents)}, gate ${eur(c.gateCents)})`,
      calc: bars.map((b) => `${b.label}: ${eur(b.cents)}${b.cause ? ` (${b.cause})` : ""}${b.season ? " season" : ""}`),
      rows: null,
      loud: !quiet,
    })),
  large: ({ ctx }) => {
    const purchases = largePurchases(ctx);
    const income = largeIncome(ctx);
    return ctx.txs
      .filter((t) => purchases.has(t.id) || income.has(t.id))
      .map((t) => {
        const bought = purchases.has(t.id);
        return { id: `large:${t.bookingDate}:${t.id}`, kind: bought ? "purchase" : "income", title: t.merchant, figure: eur(bought ? netSpend(t) : t.flows.income), calc: [`category ${t.category}`], rows: 1, loud: false };
      });
  },
  themes: ({ ctx }) => {
    const r = themesReport(ctx);
    if (!r) return [{ id: "themes:window", kind: "none", title: "no answer: under three complete months that every paying account covers", figure: "", calc: [], rows: null, loud: false }];
    type Figures = (typeof r.themes)[number]["lines"][number];
    const figures = (f: Pick<Figures, "monthlyCents" | "yearCents" | "changePct">) =>
      `${eur(f.monthlyCents)} a month, ${f.yearCents === null ? "no year" : `${eur(f.yearCents)} a year`}${f.changePct === null ? "" : `, ${f.changePct > 0 ? "+" : ""}${f.changePct} %`}`;
    return [
      {
        id: "themes:window",
        kind: "window",
        title: `${r.window.first}..${r.window.last}, ${r.window.months} months`,
        figure: `${eur(r.spendingCents)} spending`,
        calc: [
          `themes ${eur(r.totalCents)}: ${figures({ monthlyCents: r.totalMonthlyCents, yearCents: r.totalYearCents, changePct: null })}`,
          `large purchases ${eur(r.large.cents)}`,
          ...r.large.rows.map((x) => `large ${x.date} ${x.payee}: ${eur(x.cents)}`),
        ],
        rows: r.large.rows.length,
        loud: false,
      },
      ...r.themes.map((t) => ({ id: `themes:${t.id}`, kind: "theme", title: t.heading, figure: figures(t), calc: t.lines.map((l) => `${l.heading}: ${figures(l)}`), rows: null, loud: false })),
    ];
  },
  behaviour: ({ ctx }) => {
    const credit = creditStack(ctx);
    const pay = paydayEffect(ctx);
    const split = splitCandidates(ctx);
    return [
      {
        id: "behaviour:credit",
        kind: credit.told ? "told" : "quiet",
        title: `${credit.active.value} consumer credit lines running, ${credit.opened.value} opened in 180 days (${credit.active.confidence})`,
        figure: "",
        calc: [
          ...credit.lines.map((l) => `${l.kind} ${l.payee}: ${l.firstDay}..${l.lastDay}${l.active ? "" : ", ended"}${l.openedKnown ? "" : ", start before the history"}, paid ${eur(l.paid90Cents)} in 90 days`),
          ...credit.links.map((k) => `drawn ${eur(k.drawCents)} (${k.drawId}), ${eur(k.extraCents)} beyond usual instalments to other lines`),
        ],
        rows: credit.active.evidence.length,
        loud: false,
      },
      {
        id: "behaviour:payday",
        kind: pay.told ? "told" : pay.ratio ? "quiet" : "none",
        title: pay.ratio ? `days after pay at ${pay.ratio.value} times the days before, chance ${pay.chance} (${pay.ratio.confidence})` : "no answer: under six covered cycles",
        figure: pay.extraCents ? `${eur(pay.extraCents.value)} a cycle beyond the pace before` : "",
        calc: [`${pay.cycles.length} cycles counted`, ...[...new Set(pay.skipped.map((x) => x.reason))].map((r) => `skipped ${pay.skipped.filter((x) => x.reason === r).length} as ${r}`)],
        rows: pay.ratio?.evidence.length ?? null,
        loud: false,
      },
      ...split.questions.map((q) => ({
        id: `behaviour:split:${q.purchaseId}`,
        kind: "question",
        title: `${q.payee} ${q.day}: ${q.shares.value.map(eur).join(" + ")} back (${q.shares.confidence})`,
        figure: eur(q.purchaseCents),
        calc: [`left to the household ${eur(q.leftCents)}`],
        rows: q.shares.evidence.length,
        loud: false,
      })),
      ...split.busyPayers.map((b) => ({ id: `behaviour:busy:${b.key}`, kind: "question", title: `a payer of ${b.rows} payments in 90 days, ${b.busyDays} busy days`, figure: "", calc: [], rows: b.rows, loud: false })),
    ];
  },
};

/** Every statement of the given sources about one household, sorted by source and id. */
export function statements(h: Household, sources: readonly SourceId[] = SOURCE_IDS): Statement[] {
  const ctx = contextOf(h);
  const run: Run = {
    h,
    ctx,
    range: monthToDate(h.today),
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
