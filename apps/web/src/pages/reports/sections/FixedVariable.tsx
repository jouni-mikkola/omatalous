import { StackedColumns } from "../../../charts/StackedColumns.tsx";
import { money, percent } from "../../../format.ts";
import { Kv, Section } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

function FixedVariable({ ctx }: SectionProps) {
  const r = ctx.data.fixedVariable;
  const { buffer } = ctx.data;
  const t = r.totals;
  const consumption = t.fixedCents + t.habitCents + t.variableCents;
  const share = (v: number) => (consumption ? percent(v / consumption) : "–");
  return (
    <Section section={section} sub="Kiinteät ovat tilauksia ja laskuja, arkiostot toistuvia pieniä ostoja, satunnaiset kaikkea muuta">
      {buffer.advice && <p className="lead">{buffer.advice}</p>}
      <Kv
        items={[
          ["Kiinteät", `${money(t.fixedCents, false)} · ${share(t.fixedCents)}`],
          ["Arkiostot", `${money(t.habitCents, false)} · ${share(t.habitCents)}`],
          ["Satunnaiset", `${money(t.variableCents, false)} · ${share(t.variableCents)}`],
          ["Velanhoito", money(t.debtCents, false)],
        ]}
      />
      <StackedColumns
        months={r.rows.map((x) => x.month)}
        series={[
          { key: "fixed", label: "Kiinteät", color: "var(--series-1)", values: r.rows.map((x) => x.fixedCents) },
          { key: "habit", label: "Arkiostot", color: "var(--series-2)", values: r.rows.map((x) => x.habitCents) },
          { key: "variable", label: "Satunnaiset", color: "var(--series-3)", values: r.rows.map((x) => x.variableCents) },
          { key: "debt", label: "Velanhoito", color: "var(--series-7)", values: r.rows.map((x) => x.debtCents) },
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
  // the buffer advice is the lead paragraph of this card
  reports: ["fixedVariable", "buffer"],
  Component: FixedVariable,
};
