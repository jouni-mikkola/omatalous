// Decision: whether to pay a debt down first, and whether the buffer carries the household
import "../../../styles/report-debts.css";
import type { ReportPage } from "../types.ts";
import { section as Buffer } from "../sections/Buffer.tsx";
import { section as Loans } from "../sections/Loans.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "velat",
  get title() {
    return t("rpt.page_debts");
  },
  sections: [Loans, Buffer],
};
