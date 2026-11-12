// Decision: which report to open
import type { QuestionId } from "@banking/core";
import { type ReactNode, useState } from "react";
import { query } from "../../api.ts";
import { t } from "../../text.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import type { ReportPage } from "./types.ts";
import "../../styles/reports.css";

/** The address of a report: Kuukausi is what the tab opens, so it is the bare address; the others name their question and keep the period. */
export const reportHref = (id: QuestionId, period: string | null): string => (id === "kuukausi" ? "#/reports" : `#/reports${query({ q: id, period })}`);

/**
 * The list of reports, on every report page: each page that has something to show by its name, Kuukausi first, the
 * open one marked. On a phone it folds behind a button that says which report is open.
 */
function ReportList({ pages, current, params }: { pages: readonly ReportPage[]; current: QuestionId; params: URLSearchParams }) {
  const [open, setOpen] = useState(false);
  const name = pages.find((p) => p.id === current)?.title;
  return (
    <nav className={open ? "q-rail open" : "q-rail"} aria-label={t("nav.reports")}>
      <button type="button" className="q-switch" aria-expanded={open} aria-controls="q-list" onClick={() => setOpen(!open)}>
        {name ?? t("nav.reports")}
      </button>
      <ol id="q-list" className="q-list">
        {pages.map((p) => (
          <li key={p.id}>
            <a href={reportHref(p.id, params.get("period"))} aria-current={p.id === current ? "page" : undefined} onClick={() => setOpen(false)}>
              {p.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The frame of every report page: the list of reports and the open one beside it. A question page has its name as the
 * heading; Kuukausi brings its own (the month and the way to the months before), so it passes no `title`.
 */
export function Frame({ current, title, pages, params, note, children }: { current: QuestionId; title?: string; pages: readonly ReportPage[]; params: URLSearchParams; note?: string; children: ReactNode }) {
  return (
    <div className="q-frame">
      <ReportList pages={pages} current={current} params={params} />
      <div className="q-page stack">
        {(title || note) && (
          <header className="q-head">
            {title && <h2 className="q-title">{title}</h2>}
            {note && <Notice>{note}</Notice>}
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
