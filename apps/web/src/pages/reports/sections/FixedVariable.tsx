// Decision: take on a new commitment or not, build up savings or not
import { money, percent, roundedShares, shareText } from "../../../format.ts";
import { Kv } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import { UnknownShare } from "../../../components/UnknownShare.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

function FixedVariable({ ctx }: SectionProps) {
  const r = ctx.data.fixedVariable;
  const { buffer } = ctx.data;
  const t = r.totals;
  // the four parts add up to the spending of the period: the loan instalments are in the fixed ones
  const spending = t.fixedCents + t.habitCents + t.variableCents + t.debtCents;
  const all = [
    { label: "Kiinteät", cents: t.fixedCents },
    { label: "Arkiostot", cents: t.habitCents },
    { label: "Satunnaiset", cents: t.variableCents },
    { label: "Muu velanhoito", cents: t.debtCents },
  ];
  // the shares are rounded together, so the tiles add up to the 100 % they are parts of
  const units = roundedShares(all.map((p) => p.cents), spending);
  // a part the period has none of leaves no tile
  const parts = all.map((p, i) => ({ ...p, share: spending > 0 && units[i] != null ? shareText(units[i]!) : "–" })).filter((p) => p.cents !== 0);
  return (
    <Section id={section.id} title={section.title}>
      <UnknownShare share={ctx.data.cashflow.unknownShare} />
      <Kv
        items={[
          // what the fixed costs are now, against the usual income; a dash where the income or the costs are too small to tell
          ["Kiinteät menot kuukaudessa", money(buffer.fixedMonthlyCents, false)],
          ["Osuus tuloista", buffer.fixedShare === null ? "–" : percent(buffer.fixedShare)],
          ...parts.map((p): [string, string] => [p.label, `${money(p.cents, false)} · ${p.share}`]),
        ]}
      />
    </Section>
  );
}

export const section: ReportSection = {
  id: "kiinteat",
  title: "Kiinteät ja muuttuvat",
  order: 60,
  page: "reports",
  // the fixed costs a month and their share of the income are the buffer report's
  reports: ["fixedVariable", "buffer", "cashflow"],
  Component: FixedVariable,
};
