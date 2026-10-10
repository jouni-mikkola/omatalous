/**
 * Reports page: fetches the reports of the server and shows the sections of `reports/registry.ts` in order, each
 * with a link in the nav row. A section is one file in `reports/sections/`, from the whole picture to the details:
 * money in and out, where it went, month by month, what is locked in, what changed.
 */
import type { ReportId } from "@banking/core";
import { query } from "../api.ts";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { useApi } from "../hooks.ts";
import type { Meta, ReportsData, Scope } from "../types.ts";
import { visibleSections } from "./reports/registry.ts";
import type { ReportContext, ReportRange } from "./reports/types.ts";
import "../styles/reports.css";

export function Reports({ meta, range, scope }: { meta: Meta; range: ReportRange; scope: Scope }) {
  const q = query({ ...range, scope });
  const { data, error, loading, reload } = useApi<ReportsData>(`/api/reports${q}`);
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  if (!data) return <div className="empty">Ladataan…</div>;
  const ctx: ReportContext = {
    data,
    meta,
    range,
    scope,
    // the month that has not ended yet, marked in the tables
    running: range.to >= meta.today ? meta.today.slice(0, 7) : null,
    label: (id) => meta.categories.find((c) => c.id === id)?.label ?? id,
    exportHref: (report: ReportId) => `/api/export/report.csv${query({ ...range, scope, report })}`,
  };
  const sections = visibleSections(ctx);

  return (
    <div className={`stack ${loading ? "loading" : ""}`}>
      <nav className="report-nav" aria-label="Raportin osiot">
        {sections.map((s) => (
          <a
            key={s.id}
            href="#/reports"
            onClick={(e) => {
              // the hash is used by the router, so scroll instead of navigating
              e.preventDefault();
              document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            {s.title}
          </a>
        ))}
      </nav>
      {sections.map((s) => (
        <s.Component key={s.id} ctx={ctx} />
      ))}
    </div>
  );
}
