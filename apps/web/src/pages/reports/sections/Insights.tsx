// Decision: what is worth changing first
import { query } from "../../../api.ts";
import { money, plural, signedMoney } from "../../../format.ts";
import { DataTable } from "../../../components/table/DataTable.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/**
 * Every insight that passed its gate, largest yearly figure first: the overview shows the first three. Only while
 * Säästövinkit is switched off: that page shows them as Muut havainnot, where they are answered.
 */
function Insights({ ctx }: SectionProps) {
  const r = ctx.data.insights;
  return (
    <Section id={section.id} title={section.title}>
      {r.items.length ? (
        <DataTable
          id="havainnot"
          caption="Havainnot, vuosittainen vaikutus"
          rows={r.items}
          rowKey={(i) => i.id}
          columns={[
            {
              key: "item",
              label: "Havainto",
              kind: "text",
              rowHead: true,
              cell: (i) => (
                <>
                  {i.link ? <a href={`#/transactions${query({ ...i.link })}`}>{i.title}</a> : i.title}
                  <div className="sub">{i.detail}</div>
                  {i.calc && i.calc.length > 0 && <div className="sub">{i.calc.map((c) => `${c.label} ${c.value}`).join(" · ")}</div>}
                </>
              ),
            },
            {
              key: "yearly",
              label: "Vuodessa",
              kind: "money",
              main: true,
              cell: (i) => <strong>{i.direction ? signedMoney(i.direction * i.yearlyCents) : money(i.yearlyCents, false)}</strong>,
            },
          ]}
        />
      ) : (
        <div className="empty">
          Tähän tulevat hinnankorotukset, päättyneet ja uudet maksut sekä osamaksut. Vuosivertailuihin
          tarvitaan 18–24 kuukauden historia, nyt sitä on {plural(r.months, "kuukausi", "kuukautta")}.
        </div>
      )}
    </Section>
  );
}

export const section: ReportSection = {
  id: "havainnot",
  title: "Havainnot",
  order: 15,
  page: "reports",
  tab: "virta",
  reports: ["insights"],
  visible: (ctx) => !ctx.meta.features?.optimise,
  Component: Insights,
};
