// Decision: what the money goes on and which category to trim first
import "../../../styles/report-spending.css";
import type { ReportPage } from "../types.ts";
import { section as Borrowed } from "../sections/Borrowed.tsx";
import { section as CategoryGoals } from "../sections/CategoryGoals.tsx";
import { section as Drift } from "../sections/Drift.tsx";
import { section as Food } from "../sections/Food.tsx";
import { section as Pivot } from "../sections/Pivot.tsx";
import { section as SpendingTable } from "../sections/SpendingTable.tsx";
import { section as YearOverYear } from "../sections/YearOverYear.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "menot",
  get title() {
    return t("rpt.page_spending");
  },
  fold: true,
  sections: [SpendingTable, Borrowed, CategoryGoals, Drift, Food, Pivot, YearOverYear],
};
