// Decision: which of the three questions of Raportit to open, and which report of it
import { QUESTIONS, type QuestionId } from "@banking/core";
import { t } from "../../text.ts";
import { reportPage } from "./registry.ts";
import type { ReportPage } from "./types.ts";

/**
 * The three questions Raportit opens with, each the reports that refine it in the order they are told. A report keeps
 * its own address (`?q=tulot`), so a bookmark of one opens the question that holds it.
 */
const QUESTION_GROUPS: readonly { id: string; title: "rpt.q_spending" | "rpt.q_trend" | "rpt.q_shared"; members: readonly QuestionId[] }[] = [
  { id: "spending", title: "rpt.q_spending", members: ["menot", "tulot", "kiinteat"] },
  { id: "trend", title: "rpt.q_trend", members: ["saldot", "velat"] },
  { id: "shared", title: "rpt.q_shared", members: ["yhteiset"] },
];

for (const id of QUESTIONS) {
  if (QUESTION_GROUPS.filter((g) => g.members.includes(id)).length !== 1) throw new Error(`the report "${id}" belongs to exactly one question of Raportit`);
}

export interface ListedQuestion {
  id: string;
  title: string;
  /** The reports of the question that have something to show, in the order of the question. */
  pages: ReportPage[];
}

/** The questions that have a report to show, each with the reports that are open. A question with none is not listed. */
export const listedQuestions = (open: readonly QuestionId[]): ListedQuestion[] =>
  QUESTION_GROUPS.map((g) => ({ id: g.id, title: t(g.title), pages: g.members.filter((m) => open.includes(m)).map(reportPage) })).filter((g) => g.pages.length > 0);
