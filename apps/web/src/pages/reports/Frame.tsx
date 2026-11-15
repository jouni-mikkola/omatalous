// Decision: which report to open
import type { QuestionId } from "@banking/core";
import type { ReactNode } from "react";
import { query } from "../../api.ts";
import { t } from "../../text.ts";
import type { ListedQuestion } from "./question-groups.ts";
import "../../styles/reports.css";

/** The address of a report: its question and the period that is open. */
export const reportHref = (id: QuestionId, period: string | null): string => `#/reports${query({ q: id, period })}`;

/**
 * The three questions, on every report page: the open one marked. A question always opens on its first report, the one
 * that carries its name, so a link of one name leads to one place. The open question that has several reports is no link:
 * its first report is the first of the row under its name. It stands open at every width: a column beside the page, and a short list of targets above it on a phone.
 */
function QuestionList({ questions, current, params }: { questions: readonly ListedQuestion[]; current: QuestionId; params: URLSearchParams }) {
  return (
    <nav className="q-rail" aria-label={t("nav.reports")}>
      <ol className="q-list">
        {questions.map((q) => {
          const here = q.pages.some((p) => p.id === current);
          return (
            <li key={q.id}>
              {here && q.pages.length > 1 ? (
                <span className="q-here" aria-current="true">
                  {q.title}
                </span>
              ) : (
                <a href={reportHref(q.pages[0]!.id, params.get("period"))} aria-current={here ? "true" : undefined}>
                  {q.title}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The reports that refine the open question, one of them open; none when the question has one report. */
function Refinements({ question, current, params }: { question: ListedQuestion; current: QuestionId; params: URLSearchParams }) {
  if (question.pages.length < 2) return null;
  return (
    <nav className="q-refine" aria-label={question.title}>
      <ul>
        {question.pages.map((p) => (
          <li key={p.id}>
            <a href={reportHref(p.id, params.get("period"))} aria-current={p.id === current ? "page" : undefined}>
              {p.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The frame of every report page: the three questions and the open report beside them, its name as the heading and
 * the reports of its question under it.
 */
export function Frame({ current, title, questions, params, children }: { current: QuestionId; title: string; questions: readonly ListedQuestion[]; params: URLSearchParams; children: ReactNode }) {
  const question = questions.find((q) => q.pages.some((p) => p.id === current));
  return (
    <div className="q-frame">
      <QuestionList questions={questions} current={current} params={params} />
      <div className="q-page stack">
        <header className="q-head">
          <h2 className="q-title">{title}</h2>
          {question && <Refinements question={question} current={current} params={params} />}
        </header>
        {children}
      </div>
    </div>
  );
}
