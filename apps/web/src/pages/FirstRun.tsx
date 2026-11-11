/**
 * A view before the household has an account (docs/design/README.md section 4): its title, one line of what it will
 * answer, and the start card, whose button opens Asetukset > Pankit ja tilit. No sample figures stand in for the answer.
 */
import { EmptyStart } from "../components/EmptyStart.tsx";
import { t } from "../text.ts";
import type { Meta } from "../types.ts";
import "../styles/report-month.css";

/** The four tabs, by the page id of each. */
export type FirstRunView = "overview" | "reports" | "bills" | "review";

const TEXT = {
  overview: { title: () => t("nav.now"), line: () => t("rpt.first_now") },
  reports: { title: () => t("rpt.page_thismonth"), line: () => t("rpt.first_month") },
  bills: { title: () => t("nav.coming"), line: () => t("rpt.first_coming") },
  review: { title: () => t("nav.review"), line: () => t("rpt.first_review") },
} satisfies Record<FirstRunView, { title: () => string; line: () => string }>;

export function FirstRun({ view, meta, onDemo, onReload }: { view: FirstRunView; meta: Meta; onDemo: () => Promise<void>; onReload?: () => void }) {
  return (
    <div className="stack">
      <div className="first-run" data-view={view}>
        <h2 className="km-title">{TEXT[view].title()}</h2>
        <p className="km-note">{TEXT[view].line()}</p>
      </div>
      <EmptyStart onDemo={onDemo} meta={meta} onReload={onReload} />
    </div>
  );
}
