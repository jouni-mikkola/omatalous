import type { MessageCode, QuestionId } from "@banking/core";
import { ADD_ON_TARGET, SETTINGS_TARGETS } from "./routes.ts";
import { t } from "./text.ts";

/** The names of the question pages of Raportit (the pages' own `title`s), here so the shell does not load the pages to name one. */
const QUESTION_NAME = {
  tulot: "rpt.page_income",
  menot: "rpt.page_spending",
  saldot: "rpt.page_balances",
  yhteiset: "rpt.page_shared",
} as const satisfies Record<QuestionId, MessageCode>;

/**
 * The name of the open page for the tab title and the heading. Raportit and Asetukset name the tab or section that is
 * open ("Raportit: Menot kategorioittain"), so a title tells two open tabs of the same page apart.
 */
export function pageTitle(pageName: string | undefined, page: string, question: string | null, settingsTarget: string | undefined): string | undefined {
  if (!pageName) return pageName;
  if (page === "reports" && question && question in QUESTION_NAME) return `${pageName}: ${t(QUESTION_NAME[question as QuestionId])}`;
  if (page === "settings") {
    const target = [...SETTINGS_TARGETS, ADD_ON_TARGET].find((x) => x.id === settingsTarget);
    if (target) return `${pageName}: ${target.label}`;
  }
  return pageName;
}
