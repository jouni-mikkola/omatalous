// Decision: whether the debt paid and the credit drawn in the period, and what interest and fees cost, are a habit to stop
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { money } from "../../../format.ts";
import { FigureRow } from "../holdings/FigureRow.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";
import "../../../styles/statement.css";

/** The period's debt paid, new credit drawn and interest and fees: a row for each that is above zero. New credit opens its rows. */
function Borrowed({ ctx }: SectionProps) {
  const r = ctx.data.categories;
  const draws = `#/transactions?category=credit_draw&from=${ctx.range.from}&to=${ctx.range.to}`;
  return (
    <ReportPanel id={section.id} title={section.title}>
      <dl className="st-rows">
        {r.debtPaidCents > 0 && <FigureRow label={t("rpt.debt_paid")}>{money(r.debtPaidCents, false)}</FigureRow>}
        {r.creditDrawnCents > 0 && (
          <FigureRow label={t("rpt.debt_drawn")} bad>
            <a href={draws}>{money(r.creditDrawnCents, false)}</a>
          </FigureRow>
        )}
        {r.feesCents > 0 && <FigureRow label={t("rpt.leaks")}>{money(r.feesCents, false)}</FigureRow>}
      </dl>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "nostettu-luotto",
  get title() {
    return t("rpt.sec_borrowed");
  },
  order: 5,
  page: "reports",
  reports: ["categories"],
  open: true,
  // no debt, no draw and no fees: nothing to show
  visible: (ctx) => !!ctx.data.categories && (ctx.data.categories.debtPaidCents > 0 || ctx.data.categories.creditDrawnCents > 0 || ctx.data.categories.feesCents > 0),
  Component: Borrowed,
};
