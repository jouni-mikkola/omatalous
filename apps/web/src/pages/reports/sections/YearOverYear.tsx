// Decision: is the household spending more than a year ago, and on what
import { yearComparisonNote } from "@banking/core";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { SlopeChart, type SlopeItem } from "../../../charts/SlopeChart.tsx";
import { Table } from "../../../components/table/Table.tsx";
import { language, money, monthTick, signedMoney } from "../../../format.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { YEARS_ID } from "./ids.ts";
import { rich, t } from "../../../text.ts";

/** The categories on the slope: the twelve largest of either year; the five that moved most in colour. */
const SHOWN = 12;
const MOVERS = 5;

function YearOverYear({ ctx }: SectionProps) {
  const r = ctx.data.yearOverYear;
  const note = yearComparisonNote(r, language());
  const lastMonth = r.current.filter((v) => v !== null).length;
  // the months the figures hold: "2026 tähän asti" when every month so far is in, else "touko–syyskuu 2026"
  const whole = r.comparedMonths.length === lastMonth;
  const span = whole ? t("rpt.yoy_so_far", { year: r.year }) : t("rpt.yoy_span", { from: monthTick(r.comparedMonths[0]!), to: monthTick(r.comparedMonths[r.comparedMonths.length - 1]!), year: r.year });
  // fixed costs (rent, loan instalments) are left out as in Kategoriat: on one scale they flatten every other line
  const fixed = new Set(ctx.data.categories.groups.flatMap((g) => g.categories).filter((c) => c.fixedShare >= 0.5).map((c) => c.category));
  const shown = r.categories.filter((c) => !fixed.has(c.category)).slice(0, SHOWN);
  const movers = new Set([...shown].filter((c) => Math.abs(c.changeCents) >= 100_00).sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents)).slice(0, MOVERS).map((c) => c.category));
  const items: SlopeItem[] = shown.map((c) => ({ key: c.category, label: ctx.label(c.category), from: c.previousCents, to: c.currentCents, change: c.changeCents, strong: movers.has(c.category), tone: c.changeCents > 0 ? "bad" : c.changeCents < 0 ? "good" : "flat" }));
  // the largest riser among the movers, ranked by the server's change
  const rose = shown.filter((c) => movers.has(c.category) && c.changeCents > 0).sort((a, b) => (a.changeCents < b.changeCents ? 1 : a.changeCents > b.changeCents ? -1 : 0))[0];
  return (
    <ReportPanel id={section.id} title={section.title} datum={`${t("rpt.yoy_datum", { amount: money(r.ytdCents, false) })}, ${t("period.year")}`}>
      <QuestionChart
        id="vuodet-slope"
        question={t("rpt.yoy_question")}
        answer={
          <>
            {rich("rpt.yoy_answer", { span, amount: money(r.ytdCents, false), diff: money(Math.abs(r.ytdChangeCents), false), direction: t(r.ytdChangeCents >= 0 ? "rep.more" : "rep.less") })}
            {rose ? ` ${t("rpt.yoy_rose", { category: ctx.label(rose.category), change: signedMoney(rose.changeCents) })}` : ""} {note}
          </>
        }
        table={
          <Table
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
  // one or two months say nothing: with fewer than three whole months of both years there is no card
  visible: (ctx) => ctx.data.yearOverYear.comparable,
  Component: YearOverYear,
};
