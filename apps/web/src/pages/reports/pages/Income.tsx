// Decision: whether the household spends more than it earns, and whether the income holds
import "../../../styles/report-income.css";
import type { ReportPage } from "../types.ts";
import { section as Income } from "../sections/Income.tsx";
import { section as MoneyFlow } from "../sections/MoneyFlow.tsx";
import { CashflowLead, section as Months } from "../sections/Months.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "tulot",
  get title() {
    return t("rpt.page_income");
  },
  Lead: CashflowLead,
  sections: [Months, MoneyFlow, Income],
};
