// Decision: whether the household spends more than it earns
import type { ReportPage } from "../types.ts";
import { section as MoneyFlow } from "../sections/MoneyFlow.tsx";
import { CashflowLead, section as Months } from "../sections/Months.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "tulot",
  get title() {
    return t("rpt.page_income");
  },
  Lead: CashflowLead,
  sections: [Months, MoneyFlow],
};
