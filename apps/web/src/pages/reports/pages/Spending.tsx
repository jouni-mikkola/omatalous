// Decision: what the money goes on and which category to trim first
import "../../../styles/report-spending.css";
import type { ReportPage } from "../types.ts";
import { section as Borrowed } from "../sections/Borrowed.tsx";
import { section as SpendingMonths } from "../sections/SpendingMonths.tsx";
import { section as CategoryParts } from "../sections/CategoryParts.tsx";
import { section as YearOverYear } from "../sections/YearOverYear.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "menot",
  get title() {
    return t("rpt.page_spending");
  },
  fold: true,
  sections: [SpendingMonths, Borrowed, CategoryParts, YearOverYear],
};
