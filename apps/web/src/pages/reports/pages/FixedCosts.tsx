// Decision: what a month costs before any choice, and which fixed cost to cancel or renegotiate
import "../../../styles/report-fixed.css";
import type { ReportPage } from "../types.ts";
import { section as FixedCosts } from "../sections/FixedCosts.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "kiinteat",
  get title() {
    return t("rpt.page_fixedcosts");
  },
  sections: [FixedCosts],
};
