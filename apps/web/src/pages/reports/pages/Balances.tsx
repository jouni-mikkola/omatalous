// Decision: whether the household's net worth is growing, which account holds the money, and whether to pay a debt down first
import "../../../styles/report-balances.css";
import "../../../styles/report-debts.css";
import type { ReportPage } from "../types.ts";
import { section as Balances } from "../sections/Balances.tsx";
import { section as Loans } from "../sections/Loans.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "saldot",
  get title() {
    return t("rpt.page_balances");
  },
  sections: [Balances, Loans],
};
