// Decision: what the money goes on and which category to trim first
import "../../../styles/report-spending.css";
import { answerMoney } from "../../../format.ts";
import { Lead } from "../Lead.tsx";
import type { ReportPage, SectionProps } from "../types.ts";
import { section as Borrowed } from "../sections/Borrowed.tsx";
import { section as MonthChange } from "../sections/MonthChange.tsx";
import { section as SpendingMonths } from "../sections/SpendingMonths.tsx";
import { section as CategoryParts } from "../sections/CategoryParts.tsx";
import { section as YearOverYear } from "../sections/YearOverYear.tsx";
import { t } from "../../../text.ts";

/** What the period's spending came to, with the debt it paid and the credit it drew when there was any. */
function SpendingLead({ ctx }: SectionProps) {
  const r = ctx.data.categories;
  if (!r || r.totalCents <= 0) return null;
  const debt = r.debtPaidCents > 0;
  const credit = r.creditDrawnCents > 0;
  const key = debt ? (credit ? "rpt.lead_spend_debt_credit" : "rpt.lead_spend_debt") : credit ? "rpt.lead_spend_credit" : "rpt.lead_spend";
  return <Lead>{t(key, { spent: answerMoney(r.totalCents), debt: answerMoney(r.debtPaidCents), drawn: answerMoney(r.creditDrawnCents) })}</Lead>;
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
