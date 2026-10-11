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
  // a part the period has none of leaves no tile and no legend entry
  const parts = [
    { key: "fixed", rowKey: "fixedCents", label: "Kiinteät", color: "var(--series-1)", cents: t.fixedCents },
    { key: "habit", rowKey: "habitCents", label: "Arkiostot", color: "var(--series-2)", cents: t.habitCents },
    { key: "variable", rowKey: "variableCents", label: "Satunnaiset", color: "var(--series-3)", cents: t.variableCents },
    { key: "debt", rowKey: "debtCents", label: "Muu velanhoito", color: "var(--series-7)", cents: t.debtCents },
  ] as const;
  return (
    <Section id={section.id} title={section.title}>
      {buffer.advice && <p className="lead">{buffer.advice}</p>}
      {buffer.cashCents === null && <p className="lead muted">Lisää tilien saldot kohdassa Asetukset &gt; Tilit, niin näet, montako kuukautta rahat riittävät.</p>}
      <Kv items={parts.filter((p) => p.cents !== 0).map((p) => [p.label, `${money(p.cents, false)} · ${share(p.cents)}`])} />
      <StackedColumns
        months={r.rows.map((x) => x.month)}
        series={parts
          .filter((p) => p.cents !== 0)
          .map((p) => ({ key: p.key, label: p.label, color: p.color, values: r.rows.map((x) => x[p.rowKey]) }))}
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
  page: "reports",
  // the buffer advice (or the nudge to add a balance) is the lead paragraph of this card
  reports: ["fixedVariable", "buffer"],
  Component: FixedVariable,
};
