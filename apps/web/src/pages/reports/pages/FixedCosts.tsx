// Decision: which fixed cost or subscription to cancel or renegotiate
import "../../../styles/report-fixed.css";
import type { ReportPage } from "../types.ts";
import { section as FixedCosts } from "../sections/FixedCosts.tsx";
import { section as FixedVariable } from "../sections/FixedVariable.tsx";
import { section as PriceChange } from "../sections/PriceChange.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "kiinteat",
  get title() {
    return t("rpt.page_fixedcosts");
  },
  sections: [FixedCosts, FixedVariable, PriceChange],
};
