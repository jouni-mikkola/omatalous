// Decision: take on a new commitment or not, build up savings or not
import { StackedColumns } from "../../../charts/StackedColumns.tsx";
import { money, percent } from "../../../format.ts";
import { Kv } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

function FixedVariable({ ctx }: SectionProps) {
  const r = ctx.data.fixedVariable;
  const { buffer } = ctx.data;
  const t = r.totals;
  // the four parts add up to the spending of the period: the loan instalments are in the fixed ones
  const spending = t.fixedCents + t.habitCents + t.variableCents + t.debtCents;
  const share = (v: number) => (spending ? percent(v / spending) : "–");
  return (
    <Section id={section.id} title={section.title} sub="Arkiostot ovat toistuvia pieniä ostoja">
      {buffer.advice && <p className="lead">{buffer.advice}</p>}
      {buffer.cashCents === null && <p className="lead muted">Lisää saldo kohdassa Asetukset &gt; Tilit, niin näet, montako kuukautta tilien rahat riittävät menoihin.</p>}
      <Kv
        items={[
          ["Kiinteät", `${money(t.fixedCents, false)} · ${share(t.fixedCents)}`],
          ["Arkiostot", `${money(t.habitCents, false)} · ${share(t.habitCents)}`],
          ["Satunnaiset", `${money(t.variableCents, false)} · ${share(t.variableCents)}`],
          ["Muu velanhoito", `${money(t.debtCents, false)} · ${share(t.debtCents)}`],
        ]}
      />
      <StackedColumns
        months={r.rows.map((x) => x.month)}
        series={[
          { key: "fixed", label: "Kiinteät", color: "var(--series-1)", values: r.rows.map((x) => x.fixedCents) },
          { key: "habit", label: "Arkiostot", color: "var(--series-2)", values: r.rows.map((x) => x.habitCents) },
          { key: "variable", label: "Satunnaiset", color: "var(--series-3)", values: r.rows.map((x) => x.variableCents) },
          { key: "debt", label: "Muu velanhoito", color: "var(--series-7)", values: r.rows.map((x) => x.debtCents) },
        ]}
        height={240}
        label="Kiinteät ja muuttuvat menot"
      />
    </Section>
  );
}

export const section: ReportSection = {
  id: "kiinteat",
  title: "Kiinteät ja muuttuvat",
  order: 60,
  // the buffer advice (or the nudge to add a balance) is the lead paragraph of this card
  reports: ["fixedVariable", "buffer"],
  Component: FixedVariable,
};
