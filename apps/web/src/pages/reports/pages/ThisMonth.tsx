// Decision: whether this month is going the way the household expects, and what to change before it ends
import "../../../styles/report-this-month.css";
import type { ReportPage } from "../types.ts";
import { section as ThisMonth } from "../sections/ThisMonth.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "kuukausi",
  get title() {
    return t("rpt.page_thismonth");
  },
  sections: [ThisMonth],
};
