// Decision: what the money goes on and which category to trim first
import "../../../styles/report-spending.css";
import { answerMoney } from "../../../format.ts";
import { KeyValue, type Fact } from "../../../components/table/KeyValue.tsx";
import { Tiles, type TileItem } from "../../../components/Tiles.tsx";
import type { ReportPage, SectionProps } from "../types.ts";
import { categorySpendPanel } from "../MenotPanels.tsx";
import { section as MonthChange } from "../sections/MonthChange.tsx";
import { section as SpendingMonths } from "../sections/SpendingMonths.tsx";
import { section as CategoryParts } from "../sections/CategoryParts.tsx";
import { section as YearOverYear } from "../sections/YearOverYear.tsx";
import { t } from "../../../text.ts";

/**
 * What the period's spending came to: the debt it paid (interest included) and the credit it drew (a link to its rows)
 * as tiles beside the whole, and the bank and late fees as a row under them when it is a
 * hundredth of the spending or more. Every figure is the answer's.
 */
function SpendingLead({ ctx }: SectionProps) {
  const r = ctx.data.categories;
  if (!r || r.totalCents <= 0) return null;
  const items: TileItem[] = [
    { label: t("rpt.tile_spend"), figure: answerMoney(r.totalCents), panel: categorySpendPanel(ctx) },
    ...(r.debtPaidCents > 0 ? [{ label: t("rpt.tile_spend_debt"), figure: answerMoney(r.debtPaidCents) }] : []),
    ...(r.creditDrawnCents > 0 ? [{ label: t("rpt.tile_spend_credit"), figure: answerMoney(r.creditDrawnCents), tone: "bad" as const, href: `#/transactions?category=credit_draw&from=${ctx.range.from}&to=${ctx.range.to}` }] : []),
  ];
  const big = (cents: number) => cents * 100 >= r.totalCents;
  const facts: Fact[] = [
    ...(big(r.feesCents) ? [[t("rpt.leaks"), answerMoney(r.feesCents)] as const] : []),
  ];
  return (
    <>
      <Tiles items={items} />
      {facts.length > 0 && <KeyValue items={facts} />}
    </>
  );
}

export const page: ReportPage = {
  id: "menot",
  get title() {
    return t("rpt.page_spending");
  },
  Lead: SpendingLead,
  fold: true,
  sections: [MonthChange, SpendingMonths, CategoryParts, YearOverYear],
};
