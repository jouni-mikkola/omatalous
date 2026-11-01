// Decision: whether income covers spending and saving, and how much is left to save
import "../../../styles/report-income.css";
import type { ReportPage } from "../types.ts";
import { section as Income } from "../sections/Income.tsx";
import { section as Cashflow } from "../sections/Cashflow.tsx";
import { section as TaxYear } from "../sections/TaxYear.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "tulot",
  get title() {
    return t("rpt.page_income");
  },
  sections: [Income, Cashflow, TaxYear],
};
