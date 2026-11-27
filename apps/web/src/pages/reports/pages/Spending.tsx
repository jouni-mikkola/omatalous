// Decision: what the money goes on and which category to trim first
import "../../../styles/report-spending.css";
import { answerMoney } from "../../../format.ts";
import { Tiles, type TileItem } from "../../../components/Tiles.tsx";
import type { ReportPage, SectionProps } from "../types.ts";
import { section as MonthChange } from "../sections/MonthChange.tsx";
import { section as SpendingMonths } from "../sections/SpendingMonths.tsx";
import { section as CategoryParts } from "../sections/CategoryParts.tsx";
import { section as YearOverYear } from "../sections/YearOverYear.tsx";
import { t } from "../../../text.ts";

/**
 * What the period's spending came to, as tiles: the debt it paid, the credit it drew (a link to its rows), the bank and
 * late fees, and the debt savings paid, each only when there was some. Every figure is the answer's.
 */
function SpendingLead({ ctx }: SectionProps) {
  const r = ctx.data.categories;
  if (!r || r.totalCents <= 0) return null;
  // the sum holds the debt paid from savings, which the first page's Menot leave out: the tile names it
  const fromSavingsCents = ctx.data.spendingMonths?.fromSavingsCents ?? 0;
  const items: TileItem[] = [
    { label: t("rpt.tile_spend"), figure: answerMoney(r.totalCents) },
    ...(r.debtPaidCents > 0 ? [{ label: t("rpt.tile_spend_debt"), figure: answerMoney(r.debtPaidCents) }] : []),
    ...(r.creditDrawnCents > 0 ? [{ label: t("rpt.tile_spend_credit"), figure: answerMoney(r.creditDrawnCents), href: `#/transactions?category=credit_draw&from=${ctx.range.from}&to=${ctx.range.to}` }] : []),
    ...(r.feesCents > 0 ? [{ label: t("rpt.leaks"), figure: answerMoney(r.feesCents) }] : []),
    ...(fromSavingsCents !== 0 ? [{ label: t("rpt.sm_from_savings"), figure: answerMoney(fromSavingsCents) }] : []),
  ];
  return <Tiles items={items} />;
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
