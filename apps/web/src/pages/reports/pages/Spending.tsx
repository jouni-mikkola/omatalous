// Decision: what the money goes on and which category to trim first
import "../../../styles/report-spending.css";
import { answerMoney } from "../../../format.ts";
import { Tiles, type TileItem } from "../../../components/Tiles.tsx";
import type { ReportPage, SectionProps } from "../types.ts";
import { section as Borrowed } from "../sections/Borrowed.tsx";
import { section as MonthChange } from "../sections/MonthChange.tsx";
import { section as SpendingMonths } from "../sections/SpendingMonths.tsx";
import { section as CategoryParts } from "../sections/CategoryParts.tsx";
import { section as YearOverYear } from "../sections/YearOverYear.tsx";
import { t } from "../../../text.ts";

/** What the period's spending came to, as tiles, with the debt it paid and the credit it drew when there was any. */
function SpendingLead({ ctx }: SectionProps) {
  const r = ctx.data.categories;
  if (!r || r.totalCents <= 0) return null;
  const items: TileItem[] = [
    { label: t("rpt.tile_spend"), figure: answerMoney(r.totalCents) },
    ...(r.debtPaidCents > 0 ? [{ label: t("rpt.tile_spend_debt"), figure: answerMoney(r.debtPaidCents), note: t("rpt.tile_spend_debt_note") }] : []),
    ...(r.creditDrawnCents > 0 ? [{ label: t("rpt.tile_spend_credit"), figure: answerMoney(r.creditDrawnCents), note: t("rpt.tile_spend_credit_note") }] : []),
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
  sections: [MonthChange, SpendingMonths, Borrowed, CategoryParts, YearOverYear],
};
