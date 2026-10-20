/**
 * Reports page: fetches the reports of the server and shows the sections of `reports/registry.ts` in order, each
 * with a link in the nav row. A section is one file in `reports/sections/`, from the whole picture to the details:
 * money in and out, where it went, month by month, what is locked in, what changed.
 */
import { useEffect, useRef } from "react";
import { query } from "../api.ts";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { useApi } from "../hooks.ts";
import type { Meta, ReportsData, Scope } from "../types.ts";
import { hashOf } from "../routes.ts";
import { reportContext } from "./reports/context.ts";
import { reportsOf, visibleSections } from "./reports/registry.ts";
import type { ReportRange, ReportTab } from "./reports/types.ts";
import "../styles/reports.css";

/** The tabs in their order; the sections of a tab are those that name it (`ReportSection.tab`). */
export const REPORT_TABS: readonly { id: ReportTab; label: string }[] = [
  { id: "virta", label: "Rahavirta" },
  { id: "menot", label: "Menot" },
  { id: "varat", label: "Varat ja velat" },
];
type TabId = ReportTab;

/** Loading: the tabs and the first panel at the size it will have, a chart's frame and five rows, with no figures. */
function ReportsSkeleton() {
  return (
    <div className="stack" aria-busy="true" aria-label="Raportit latautuvat">
      <div className="report-tabs" aria-hidden="true">
        {REPORT_TABS.map((t) => (
          <button key={t.id} type="button" disabled>
            {t.label}
          </button>
        ))}
      </div>
      <section className="card skeleton-card" aria-hidden="true">
        <div className="card-head tb">
          <div className="card-name">
            <span className="sk sk-title" />
          </div>
          <div className="card-datum">
            <span className="sk sk-figure" />
          </div>
        </div>
        <span className="sk sk-line" />
        <span className="sk sk-line sk-short" />
        <span className="sk sk-plot" />
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="sk sk-row" />
        ))}
      </section>
    </div>
  );
}

export function Reports({ meta, range, scope, params, anchor }: { meta: Meta; range: ReportRange; scope: Scope; params?: URLSearchParams; anchor?: string }) {
  // the reports this page's sections read: the spending change is Yhteenveto's
  const q = query({ ...range, scope, reports: reportsOf("reports").join(",") });
  const { data, error, loading, reload } = useApi<ReportsData>(`/api/reports${q}`);
  // an address names a section (#/reports?period=12m#kuukaudet from Yhteenveto): scroll to it once the sections are there
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!anchor || !data || scrolledFor.current === anchor) return;
    scrolledFor.current = anchor;
    document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  }, [anchor, data]);
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  if (!data) return <ReportsSkeleton />;
  const ctx = reportContext(data, meta, range, scope);
  // an anchor picks the tab that holds its section, so an old address to #kuukaudet still lands on it
  const asked = params?.get("tab");
  const all = visibleSections(ctx, "reports");
  const tab: TabId = all.find((s) => s.id === anchor)?.tab ?? REPORT_TABS.find((t) => t.id === asked)?.id ?? "virta";
  const current = REPORT_TABS.find((t) => t.id === tab)!;
  // a section in no tab is not drawn: Havainnot is Säästövinkit's Muut havainnot (lead decision)
  const sections = all.filter((s) => s.tab === tab);
  const pick = (id: TabId) => {
    const next = new URLSearchParams(params);
    next.set("tab", id);
    location.hash = hashOf({ page: "reports", params: next });
  };

  return (
    <div className={`stack ${loading ? "loading" : ""}`}>
      <div className="report-tabs" role="tablist" aria-label="Raportit">
        {REPORT_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={t.id === tab} aria-controls="report-panel" onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <nav className="report-nav" aria-label={`${current.label}: osiot`}>
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
      <div id="report-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="stack">
        {sections.map((s) => (
          <s.Component key={s.id} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}
