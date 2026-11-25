// Decision: which report to open
import type { QuestionId } from "@banking/core";
import type { ReactNode } from "react";
import { query } from "../../api.ts";
import { t } from "../../text.ts";
import type { ReportPage } from "./types.ts";
import "../../styles/reports.css";

/** The address of a report: its question and the period that is open. */
export const reportHref = (id: QuestionId, period: string | null): string => `#/reports${query({ q: id, period })}`;

type Listed = Pick<ReportPage, "id" | "title">;

/**
 * The reports that have something to show, on every report page, as tabs above the page with the open one marked. The
 * period switch shares their row on a wide screen and sits under them on a phone, which scrolls the tabs sideways.
 */
function QuestionList({ pages, current, params }: { pages: readonly Listed[]; current: QuestionId; params: URLSearchParams }) {
  return (
    <nav className="q-tabs" aria-label={t("nav.reports")}>
      <ol className="q-list">
        {pages.map((p) => (
          <li key={p.id}>
            <a href={reportHref(p.id, params.get("period"))} aria-current={p.id === current ? "true" : undefined}>
              {p.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The frame of every report page: the tabs of the reports with the period switch (when the report has one), and the open report under them, its name as the heading and its lead sentence under it. */
export function Frame({ current, title, lead, pages, params, period, children }: { current: QuestionId; title: string; lead?: ReactNode; pages: readonly Listed[]; params: URLSearchParams; period?: ReactNode; children: ReactNode }) {
  return (
    <div className="q-frame">
      <div className="q-bar">
        <QuestionList pages={pages} current={current} params={params} />
        {period}
      </div>
      <div className="q-page stack">
        <header className="q-head">
          <h2 className="q-title">{title}</h2>
        </header>
        {lead}
        {children}
      </div>
    </div>
  );
}
