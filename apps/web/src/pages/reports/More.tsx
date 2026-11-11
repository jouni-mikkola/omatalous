/**
 * Kuukausi and Lisää: a bare address opens the month; any other fetches the reports of the server and shows one question page of `reports/pages/` in the frame
 * (`reports/Frame.tsx`). The address names the question (`?q=menot`), the comparison (`compare=previous`) and the
 * period (`period=12m`). An anchor in an old address (`#kuukaudet`) opens the page that holds that section.
 */
import { t } from "../../text.ts";
import { REPORT_PERIODS } from "../../period.ts";
import { QUESTIONS, type QuestionId } from "@banking/core";
import { useEffect, useRef } from "react";
import { query } from "../../api.ts";
import { ErrorCard } from "../../components/ErrorCard.tsx";
import { useApi } from "../../hooks.ts";
import type { Meta, ReportsData, Scope } from "../../types.ts";
import { reportContext } from "./context.ts";
import { Frame, moreLabel } from "./Frame.tsx";
import { Month } from "./Month.tsx";
import { REPORT_PAGES, reportPage, reportsOfPage, visiblePageSections } from "./registry.ts";
import type { ReportContext, ReportRange } from "./types.ts";
import { FoldContext } from "../../components/Section.tsx";
import "../../styles/reports.css";

/** Loading: the question and the first panel at the size they will have, with no figures. */
function ReportsSkeleton() {
  return (
    <div className="stack" aria-busy="true" aria-label={t("rpt.reports_loading")}>
      <span className="sk sk-title" aria-hidden="true" />
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

/** The questions that have a section to show for this answer, in the order of the list. */
const openQuestions = (ctx: ReportContext): QuestionId[] => REPORT_PAGES.filter((p) => visiblePageSections(ctx, p).length > 0).map((p) => p.id);

/**
 * The question to open: the page that holds the anchored section, else the one `q` names when it has something to show,
 * else the first that follows the chosen period. The month question ignores the period, so a bare address never lands on it
 * and hides the switch the reader just used.
 */
export function questionOf(open: readonly QuestionId[], asked: string | null, anchor: string | undefined): QuestionId {
  const byAnchor = anchor ? REPORT_PAGES.find((p) => open.includes(p.id) && p.sections.some((s) => s.id === anchor))?.id : undefined;
  return byAnchor ?? open.find((id) => id === asked) ?? open.find((id) => id !== "kuukausi") ?? open[0] ?? QUESTIONS[0];
}

/**
 * The line above a page opened in place of the one the address asked for, which has nothing to show (an old link or a bookmark).
 * Without it the address says one report and the page shows another.
 */
export function askedNote(asked: string | null, shown: QuestionId): string | undefined {
  if (!asked || asked === shown) return undefined;
  if (asked === "yhteiset") return t("rpt.q_not_open");
  const name = REPORT_PAGES.some((p) => p.id === asked) ? (moreLabel(asked as QuestionId) ?? reportPage(asked as QuestionId).title) : undefined;
  return name ? t("rpt.q_empty", { name }) : undefined;
}

type ReportsProps = { meta: Meta; range: ReportRange; scope: Scope; params?: URLSearchParams; anchor?: string; onQuestion?: (question: string | null) => void };

/** Kuukausi is what the tab opens: an address that names no question, period, comparison or section. The question pages stay behind their addresses. */
export const isMonth = (params: URLSearchParams | undefined, anchor: string | undefined): boolean => !anchor && !["q", "period", "compare"].some((key) => params?.has(key));

export function More(props: ReportsProps) {
  return isMonth(props.params, props.anchor) ? <MonthTab {...props} /> : <Questions {...props} />;
}

/** The month has no period of its own, so the shell is told the running month is open and shows no period switch. */
function MonthTab({ meta, range, scope, onQuestion }: ReportsProps) {
  useEffect(() => {
    onQuestion?.("kuukausi");
    return () => onQuestion?.(null);
  }, [onQuestion]);
  return <Month meta={meta} range={range} scope={scope} />;
}

function Questions({ meta, range, scope, params, anchor, onQuestion }: ReportsProps) {
  // every page's reports are asked for at once, so a switch of question needs no new answer
  const wanted = [...new Set(REPORT_PAGES.flatMap(reportsOfPage))];
  const { data, error, loading, reload } = useApi<ReportsData>(`/api/reports${query({ ...range, scope, reports: wanted.join(",") })}`);
  // an address names a section (#/reports?period=12m#kuukaudet from Yhteenveto): scroll to it once the sections are there
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!anchor || !data || scrolledFor.current === anchor) return;
    scrolledFor.current = anchor;
    document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  }, [anchor, data]);
  const open = params ?? new URLSearchParams();
  const span = REPORT_PERIODS.find((p) => p.id === open.get("period"))?.label ?? REPORT_PERIODS.find((p) => p.id === "12m")?.label;
  const ctx = data ? { ...reportContext(data, meta, range, scope, reload), compare: open.get("compare"), span } : null;
  const questions = ctx ? openQuestions(ctx) : [];
  const shown = ctx ? questionOf(questions, open.get("q"), anchor) : null;
  useEffect(() => {
    onQuestion?.(shown);
    return () => onQuestion?.(null);
  }, [shown, onQuestion]);
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  if (!ctx || !shown) return <ReportsSkeleton />;
  const page = reportPage(shown);
  const sections = visiblePageSections(ctx, page);

  return (
    <div className={loading ? "loading" : undefined}>
      <Frame page={page} pages={REPORT_PAGES.filter((p) => questions.includes(p.id))} params={open} note={askedNote(open.get("q"), page.id)}>
        {sections.map((s) =>
          page.fold ? (
            <FoldContext.Provider key={s.id} value={{ open: !!s.open || s.id === anchor }}>
              <s.Component ctx={ctx} />
            </FoldContext.Provider>
          ) : (
            <s.Component key={s.id} ctx={ctx} />
          ),
        )}
      </Frame>
    </div>
  );
}
