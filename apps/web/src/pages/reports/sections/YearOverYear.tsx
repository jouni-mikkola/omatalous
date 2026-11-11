// Decision: is the household spending more than a year ago, and on what
import { comparisonYearRange, comparisonYears, yearComparisonNote } from "@banking/core";
import { useState } from "react";
import { query } from "../../../api.ts";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { SlopeChart, type SlopeItem } from "../../../charts/SlopeChart.tsx";
import { Table } from "../../../components/table/Table.tsx";
import { Empty } from "../../../components/ui/Empty.tsx";
import { Notice } from "../../../components/ui/Notice.tsx";
import { language, money, monthTick, signedMoney } from "../../../format.ts";
import { useApi } from "../../../hooks.ts";
import type { ReportsData } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { YEARS_ID } from "./ids.ts";
import { rich, t } from "../../../text.ts";

/** The categories on the slope: the twelve largest of either year; the five that moved most in colour. */
const SHOWN = 12;
const MOVERS = 5;

/**
 * The category the sentence names: the largest rise of at least 100 € among every category of the table, fixed costs
 * too, as the total they add up to has them. The slope leaves fixed costs out only to keep its scale.
 */
export function largestRise<C extends { changeCents: number }>(categories: readonly C[]): C | undefined {
  return categories.filter((c) => c.changeCents >= 100_00).sort((a, b) => b.changeCents - a.changeCents)[0];
}

function YearOverYear({ ctx }: SectionProps) {
  // the page's answer is the year its period ends in; another year is picked here and asked for by itself
  const own = ctx.data.yearOverYear;
  const [chosen, setChosen] = useState<number | null>(null);
  const picked = chosen ?? own.year;
  const other = picked !== own.year;
  // the picked year's categories come along: they say which categories were fixed costs in that year
  const path = other ? `/api/reports${query({ ...comparisonYearRange(picked, ctx.meta.today), scope: ctx.scope, reports: "yearOverYear,categories" })}` : null;
  const { data, error } = useApi<Pick<ReportsData, "yearOverYear" | "categories">>(path);
  // while another year loads `useApi` still holds the answer before it: that year's figures are not shown under the new one
  const r = other ? (data?.yearOverYear.year === picked ? data.yearOverYear : undefined) : own;
  const years = [...new Set([own.year, ...comparisonYears(own.dataFrom, ctx.meta.today)])].sort((a, b) => b - a);
  const picker =
    years.length > 1 ? (
      <select value={picked} aria-label={t("rpt.more_year")} onChange={(e) => setChosen(Number(e.target.value))}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    ) : undefined;
  if (!r)
    return (
      <ReportPanel id={section.id} title={section.title} actions={picker}>
        {error ? <Notice tone="error">{error}</Notice> : <Empty>{t("rpt.loading")}</Empty>}
      </ReportPanel>
    );
  // an earlier year is whole: its figures are named by their months, not as "so far"
  const past = r.year < Number(ctx.meta.today.slice(0, 4));
  const note = yearComparisonNote(r, language());
  // a picked year with too few months of both years has no comparison: the card says why and keeps the picker
  if (!r.comparable)
    return (
      <ReportPanel id={section.id} title={section.title} actions={picker}>
        <Empty>{note}</Empty>
      </ReportPanel>
    );
  const lastMonth = r.current.filter((v) => v !== null).length;
  // the months the figures hold: "2026 tähän asti" when every month so far is in, else "touko–syyskuu 2026"
  const whole = !past && r.comparedMonths.length === lastMonth;
  const span = whole ? t("rpt.yoy_so_far", { year: r.year }) : t("rpt.yoy_span", { from: monthTick(r.comparedMonths[0]!), to: monthTick(r.comparedMonths[r.comparedMonths.length - 1]!), year: r.year });
  // fixed costs (rent, loan instalments) are left out as in Kategoriat: on one scale they flatten every other line
  const fixed = new Set((other && data ? data : ctx.data).categories.groups.flatMap((g) => g.categories).filter((c) => c.fixedShare >= 0.5).map((c) => c.category));
  const shown = r.categories.filter((c) => !fixed.has(c.category)).slice(0, SHOWN);
  const movers = new Set([...shown].filter((c) => Math.abs(c.changeCents) >= 100_00).sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents)).slice(0, MOVERS).map((c) => c.category));
  const items: SlopeItem[] = shown.map((c) => ({ key: c.category, label: ctx.label(c.category), from: c.previousCents, to: c.currentCents, change: c.changeCents, strong: movers.has(c.category), tone: c.changeCents > 0 ? "bad" : c.changeCents < 0 ? "good" : "flat" }));
  const rose = largestRise(r.categories);
  return (
    <ReportPanel id={section.id} title={section.title} datum={`${t("rpt.yoy_datum", { amount: money(r.ytdCents, false) })}, ${past ? r.year : t("period.year")}`} actions={picker}>
      <QuestionChart
        id="vuodet-slope"
        question={past ? t("rpt.yoy_chart", { previous: r.year - 1, year: r.year }) : t("rpt.yoy_question")}
        answer={
          <>
            {rich("rpt.yoy_answer", { span, amount: money(r.ytdCents, false), diff: money(Math.abs(r.ytdChangeCents), false), direction: t(r.ytdChangeCents >= 0 ? "rep.more" : "rep.less") })}
            {rose ? ` ${t("rpt.yoy_rose", { category: ctx.label(rose.category), change: signedMoney(rose.changeCents) })}` : ""} {note}
          </>
        }
        table={
          <Table
            key={r.year}
            caption={t("rpt.yoy_caption")}
            rows={r.categories}
            rowKey={(c) => c.category}
            columns={[
              { key: "category", label: t("rpt.category"), kind: "text", rowHead: true, cell: (c) => ctx.label(c.category) },
              { key: "previous", label: String(r.year - 1), kind: "money", cents: (c) => c.previousCents },
              { key: "current", label: String(r.year), kind: "money", cents: (c) => c.currentCents },
              { key: "change", label: t("rpt.change"), kind: "money", cell: (c) => signedMoney(c.changeCents) },
            ]}
          />
        }
      >
        {items.length > 1 && <SlopeChart items={items} fromLabel={String(r.year - 1)} toLabel={String(r.year)} label={t("rpt.yoy_chart", { previous: r.year - 1, year: r.year })} />}
      </QuestionChart>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: YEARS_ID,
  get title() {
    return t("rpt.sec_yearoveryear");
  },
  order: 90,
  page: "reports",
  // the categories report says which categories are fixed costs
  reports: ["yearOverYear", "categories"],
  // one or two months say nothing: with fewer than three whole months of both years there is no card,
  // unless an earlier year can be picked: then the card stays for its year menu
  visible: (ctx) => ctx.data.yearOverYear.comparable || comparisonYears(ctx.data.yearOverYear.dataFrom, ctx.meta.today).length > 1,
  Component: YearOverYear,
};
