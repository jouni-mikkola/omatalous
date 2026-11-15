// Decision: which report to open
import type { QuestionId } from "@banking/core";
import type { ReactNode } from "react";
import { query } from "../../api.ts";
import { t } from "../../text.ts";
import type { ReportPage } from "./types.ts";
import "../../styles/reports.css";

/** The address of a report: its question and the period that is open. */
export const reportHref = (id: QuestionId, period: string | null): string => `#/reports${query({ q: id, period })}`;

/**
 * The list of reports, on every report page: each page that has something to show by its name, the
 * open one marked. It stands open at every width: a column beside the page, and two columns of targets above it on a phone.
 */
function ReportList({ pages, current, params }: { pages: readonly ReportPage[]; current: QuestionId; params: URLSearchParams }) {
  return (
    <nav className="q-rail" aria-label={t("nav.reports")}>
      <ol className="q-list">
        {pages.map((p) => (
          <li key={p.id}>
            <a href={reportHref(p.id, params.get("period"))} aria-current={p.id === current ? "page" : undefined}>
              {p.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The frame of every report page: the list of reports and the open one beside it, its name as the heading.
 */
export function Frame({ current, title, pages, params, children }: { current: QuestionId; title: string; pages: readonly ReportPage[]; params: URLSearchParams; children: ReactNode }) {
  return (
    <div className="q-frame">
      <ReportList pages={pages} current={current} params={params} />
      <div className="q-page stack">
        <header className="q-head">
          <h2 className="q-title">{title}</h2>
        </header>
        {children}
      </div>
    </div>
  );
}
