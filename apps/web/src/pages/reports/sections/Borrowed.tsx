// Decision: whether the credit drawn in the period is a habit to stop, and what it adds to what is owed
import { coverOf } from "@banking/core";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { inSpan } from "../parts.tsx";
import { money } from "../../../format.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { rich, t } from "../../../text.ts";

function Borrowed({ ctx }: SectionProps) {
  const drawn = coverOf(ctx.data.cashflow.totals).creditDrawnCents;
  const rows = `#/transactions?category=credit_draw&from=${ctx.range.from}&to=${ctx.range.to}`;
  return (
    <ReportPanel id={section.id} title={section.title} datum={inSpan(ctx, money(drawn, false))}>
      <p>{rich("rpt.borrowed_text", { amount: money(drawn, false) })}</p>
      <a href={rows}>{t("rpt.borrowed_link")}</a>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "nostettu-luotto",
  get title() {
    return t("rpt.sec_borrowed");
  },
  order: 32,
  page: "reports",
  reports: ["cashflow"],
  // no draw, nothing to explain
  visible: (ctx) => !!ctx.data.cashflow && coverOf(ctx.data.cashflow.totals).creditDrawnCents > 0,
  Component: Borrowed,
};
