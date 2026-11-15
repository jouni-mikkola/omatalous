// Decision: whether the household's net worth is growing, and which account holds the money
import "../../../styles/report-balances.css";
import type { ReportPage } from "../types.ts";
import { section as Balances } from "../sections/Balances.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "saldot",
  get title() {
    return t("rpt.page_balances");
  },
  sections: [Balances],
};
