// Decision: whether the income holds, and which rows of the year go against the tax return
import "../../../styles/report-income.css";
import type { ReportPage } from "../types.ts";
import { section as Income } from "../sections/Income.tsx";
import { section as TaxYear } from "../sections/TaxYear.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "tulot",
  get title() {
    return t("rpt.page_income");
  },
  sections: [Income, TaxYear],
};
