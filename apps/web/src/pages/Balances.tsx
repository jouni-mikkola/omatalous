/**
 * Varat ja velat: what the accounts and cards hold, what is owed, and the loans, a page of the header. It reads its
 * sections of `reports/sections/` (page `balances`) and has no period: the balance is today's, the trend is the last
 * twelve months. A household with no bank can still add a loan here.
 */
import { useEffect, useRef, useState } from "react";
import { query } from "../api.ts";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { useApi } from "../hooks.ts";
import { periodRange } from "../period.ts";
import { t } from "../text.ts";
import type { Meta, ReportsData, Scope } from "../types.ts";
import { reportContext } from "./reports/context.ts";
import { BalancesTiles } from "./reports/sections/Balances.tsx";
import { REPORT_SECTIONS, visibleSections } from "./reports/registry.ts";
import "../styles/reports.css";
import "../styles/report-balances.css";
import "../styles/report-debts.css";

const SECTIONS = REPORT_SECTIONS.filter((s) => s.page === "balances");
const REPORTS = [...new Set(SECTIONS.flatMap((s) => s.reports))];

export function Balances({ meta, scope, anchor }: { meta: Meta; scope: Scope; anchor?: string }) {
  const range = periodRange("12m", meta.today, meta.opening);
  const { data, error, loading, reload } = useApi<ReportsData>(`/api/reports${query({ ...range, scope, reports: REPORTS.join(",") })}`);
  const [loanSaid, sayLoan] = useState<string | null>(null);
  // an address names a section (#/balances#lainat): scroll to it once the sections are there
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!anchor || !data || scrolledFor.current === anchor) return;
    scrolledFor.current = anchor;
    document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  }, [anchor, data]);
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  if (!data) return <div className="stack" aria-busy="true" aria-label={t("rpt.reports_loading")} />;
  const ctx = { ...reportContext(data, meta, range, scope, reload), loanSaid, sayLoan };
  return (
    <div className={loading ? "loading" : undefined}>
      <div className="q-page stack">
        <header className="q-head">
          <h2 className="q-title">{t("rpt.page_balances")}</h2>
        </header>
        <BalancesTiles ctx={ctx} />
        {visibleSections(ctx, "balances").map((s) => (
          <s.Component key={s.id} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}
