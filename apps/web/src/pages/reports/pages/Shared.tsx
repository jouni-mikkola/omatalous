// Decision: who owes whom on the joint accounts
import "../../../styles/report-shared.css";
import type { ReportPage } from "../types.ts";
import { section as Settlement } from "../sections/Settlement.tsx";
import { t } from "../../../text.ts";

export const page: ReportPage = {
  id: "yhteiset",
  get title() {
    return t("rpt.page_shared");
  },
  sections: [Settlement],
};
