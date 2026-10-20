// Decision: is the household spending more than a year ago, and on what
import { yearComparisonNote } from "@banking/core";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { SlopeChart, type SlopeItem } from "../../../charts/SlopeChart.tsx";
import { DataTable } from "../../../components/table/DataTable.tsx";
import { money, MONTHS_SHORT, signedMoney } from "../../../format.ts";
import type { ReportSection, SectionProps } from "../types.ts";

/** The categories on the slope: the twelve largest of either year; the five that moved most in colour. */
const SHOWN = 12;
const MOVERS = 5;

function YearOverYear({ ctx }: SectionProps) {
  const r = ctx.data.yearOverYear;
  const note = yearComparisonNote(r);
  const lastMonth = r.current.filter((v) => v !== null).length;
  // the months the figures hold: "2026 tähän asti" when every month so far is in, else "touko–syyskuu 2026"
  const whole = r.comparedMonths.length === lastMonth;
  const span = whole ? `${r.year} tähän asti` : `${MONTHS_SHORT[r.comparedMonths[0]! - 1]}–${MONTHS_SHORT[r.comparedMonths[r.comparedMonths.length - 1]! - 1]}kuu ${r.year}`;
  // fixed costs (rent, loan instalments) are left out as in Kategoriat: on one scale they flatten every other line
  const fixed = new Set(ctx.data.categories.groups.flatMap((g) => g.categories).filter((c) => c.fixedShare >= 0.5).map((c) => c.category));
  const shown = r.categories.filter((c) => !fixed.has(c.category)).slice(0, SHOWN);
  const movers = new Set([...shown].filter((c) => Math.abs(c.changeCents) >= 100_00).sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents)).slice(0, MOVERS).map((c) => c.category));
  const items: SlopeItem[] = shown.map((c) => ({ key: c.category, label: ctx.label(c.category), from: c.previousCents, to: c.currentCents, change: c.changeCents, strong: movers.has(c.category), tone: c.changeCents > 0 ? "bad" : c.changeCents < 0 ? "good" : "flat" }));
  // the largest riser among the movers, ranked by the server's change
  const rose = shown.filter((c) => movers.has(c.category) && c.changeCents > 0).sort((a, b) => (a.changeCents < b.changeCents ? 1 : a.changeCents > b.changeCents ? -1 : 0))[0];
  return (
    <ReportPanel id={section.id} title={section.title} datum={r.comparable ? `Menot ${money(r.ytdCents, false)}` : undefined}>
      <QuestionChart
        id="vuodet-slope"
        question="Mihin menee enemmän kuin viime vuonna?"
        answer={
          !r.comparable ? (
            (note ?? "")
          ) : (
            <>
              Menoja on {span} <strong>{money(r.ytdCents, false)}</strong>, {money(Math.abs(r.ytdChangeCents), false)} {r.ytdChangeCents >= 0 ? "enemmän" : "vähemmän"} kuin samaan aikaan vuotta aiemmin.
              {rose ? ` Menot kasvoivat eniten kategoriassa ${ctx.label(rose.category)}: ${signedMoney(rose.changeCents)}.` : ""} {note}
            </>
          )
        }
        table={
          <DataTable
            id="vuodet"
            caption="Menot kategorioittain, kaksi vuotta"
            rows={r.categories}
            rowKey={(c) => c.category}
            columns={[
              { key: "category", label: "Kategoria", kind: "text", rowHead: true, cell: (c) => ctx.label(c.category) },
              { key: "previous", label: String(r.year - 1), kind: "money", cents: (c) => c.previousCents },
              { key: "current", label: String(r.year), kind: "money", cents: (c) => c.currentCents },
              { key: "change", label: "Muutos", kind: "money", cell: (c) => signedMoney(c.changeCents), sortValue: (c) => c.changeCents },
            ]}
          />
        }
      >
        {r.comparable && items.length > 1 && <SlopeChart items={items} fromLabel={String(r.year - 1)} toLabel={String(r.year)} label={`Menot kategorioittain ${r.year - 1} ja ${r.year} samoina kuukausina`} />}
      </QuestionChart>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "vuodet",
  title: "Vuosivertailu",
  order: 90,
  page: "reports",
  tab: "menot",
  // the categories report says which categories are fixed costs
  reports: ["yearOverYear", "categories"],
  // one or two months say nothing: with fewer than three whole months of both years the section says why
  visible: (ctx) => ctx.data.yearOverYear.comparable || ctx.data.yearOverYear.dataFrom !== null,
  Component: YearOverYear,
};
