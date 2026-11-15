/**
 * A view before the household has an account (docs/design/README.md section 4): its title and the start card, whose
 * button opens Asetukset > Pankit ja tilit. No sample figures stand in for the answer.
 */
import { EmptyStart } from "../components/EmptyStart.tsx";
import { t } from "../text.ts";
import type { Meta } from "../types.ts";
import "../styles/first-run.css";

/** The views that have a first-run page, by the page id of each. */
export type FirstRunView = "overview" | "reports" | "bills" | "review";

const TITLE = {
  overview: () => t("nav.overview"),
  reports: () => t("nav.reports"),
  bills: () => t("nav.bills"),
  review: () => t("nav.review"),
} satisfies Record<FirstRunView, () => string>;

export function FirstRun({ view, meta, onDemo, onReload }: { view: FirstRunView; meta: Meta; onDemo: () => Promise<void>; onReload?: () => void }) {
  return (
    <div className="stack">
      <div className="first-run" data-view={view}>
        <h2 className="first-run-title">{TITLE[view]()}</h2>
      </div>
      <EmptyStart onDemo={onDemo} meta={meta} onReload={onReload} />
    </div>
  );
}
