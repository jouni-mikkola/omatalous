// Decision: which question to look at next, and what the household should do about the one open
import { type CompareKind, type ConclusionsReport, type QuestionId, QUESTIONS } from "@banking/core";
import { type ReactNode, useState } from "react";
import { query } from "../../api.ts";
import { money } from "../../format.ts";
import { t } from "../../text.ts";
import { navigate } from "../../hooks.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import { Basis } from "./Basis.tsx";
import { Compare, chosenKind } from "./Compare.tsx";
import { Notices, Recommendation, Verdict } from "./Verdict.tsx";
import type { ReportContext, ReportPage } from "./types.ts";
import "../../styles/reports.css";

/** The questions that have something to say, in the order of the list. */
export const openQuestions = (conclusions: ConclusionsReport): QuestionId[] => QUESTIONS.filter((id) => conclusions[id] !== null);

/** What period a question's figure covers, so a list that mixes sums of the period, of one month and of a day says which. */
const FIGURE_SPAN: Record<QuestionId, "period" | "month" | "end" | "running"> = { kuukausi: "running", menot: "period", tulot: "period", kiinteat: "month", velat: "end", saldot: "end", yhteiset: "period" };

/** The figure of a question with the span it covers. */
const figureLine = (id: QuestionId, cents: number, period: string | undefined): string => {
  const amount = money(cents, false);
  const span = FIGURE_SPAN[id];
  return span === "period" ? (period ? `${amount}, ${period}` : amount) : t(`rpt.span_${span}` as "rpt.span_month", { amount });
};

/** The list of questions: the open one marked, each with its figure and comparison in a line. On a phone it folds behind "Aiheet". */
function Questions({ conclusions, current, params, span }: { conclusions: ConclusionsReport; current: QuestionId; params: URLSearchParams; span?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <nav className={open ? "q-rail open" : "q-rail"} aria-label={t("rpt.questions")}>
      <button type="button" className="q-switch" aria-expanded={open} aria-controls="q-list" onClick={() => setOpen(!open)}>
        {t("rpt.questions")}
      </button>
      <ol id="q-list" className="q-list">
        {openQuestions(conclusions).map((id) => {
          const c = conclusions[id]!;
          const line = c.verdict.comparison?.text ?? figureLine(id, c.verdict.figure.cents, span);
          return (
            <li key={id}>
              <a href={`#/reports${query({ q: id, period: params.get("period"), compare: params.get("compare") })}`} aria-current={id === current ? "page" : undefined} onClick={() => setOpen(false)}>
                {c.question}
                <small>{line}</small>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The frame of every question page: the list of questions, the open one as a heading with its verdict, the switch of the
 * comparison, the one recommendation, the sections the page assembled and the basis. The comparison and the question are
 * in the address, so a link keeps them.
 */
export function Frame({ ctx, page, conclusions, params, note, children }: { ctx: ReportContext; page: ReportPage; conclusions: ConclusionsReport; params: URLSearchParams; note?: string; children: ReactNode }) {
  const conclusion = conclusions[page.id]!;
  const kind: CompareKind | null = chosenKind(conclusion, params.get("compare"));
  return (
    <div className="q-frame">
      <Questions conclusions={conclusions} current={page.id} params={params} span={ctx.span} />
      <div className="q-page stack">
        <header className="q-head">
          <h2 className="q-title">{conclusion.question}</h2>
          <Verdict conclusion={conclusion} kind={kind} />
          {note && <Notice>{note}</Notice>}
          <Notices conclusion={conclusion} />
          <Compare conclusion={conclusion} value={kind} onChange={(k) => navigate("reports", { compare: k }, true)} />
          <Recommendation conclusion={conclusion} />
        </header>
        {children}
        <Basis conclusion={conclusion} ctx={ctx} />
      </div>
    </div>
  );
}
