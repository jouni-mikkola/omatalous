import { QUESTIONS, type QuestionId, type ReportId } from "@banking/core";
import type { ReportContext, ReportPage, ReportSection, SectionPage } from "./types.ts";

// Every file in pages/ is a question page of Raportit and names its own sections, so a page task edits its own file only.
const pageModules = import.meta.glob<{ page?: ReportPage }>("./pages/*.tsx", { eager: true });

/** The question pages in the order of the list (`QUESTIONS`). */
export const REPORT_PAGES: readonly ReportPage[] = Object.entries(pageModules)
  .map(([path, m]) => {
    if (!m.page) throw new Error(`${path} must export \`page\``);
    return m.page;
  })
  .sort((a, b) => QUESTIONS.indexOf(a.id) - QUESTIONS.indexOf(b.id));

for (const id of QUESTIONS) {
  if (REPORT_PAGES.filter((p) => p.id === id).length !== 1) throw new Error(`the question "${id}" needs exactly one file in pages/`);
}

export const reportPage = (id: QuestionId): ReportPage => REPORT_PAGES.find((p) => p.id === id)!;

/** The sections of a question page that have something to show for this answer, in page order. */
export function visiblePageSections(ctx: ReportContext, page: ReportPage): ReportSection[] {
  return [...page.sections].sort((a, b) => a.order - b.order).filter((s) => s.visible?.(ctx) ?? true);
}

/** The core reports a question page asks for: those of its sections. */
export function reportsOfPage(page: ReportPage): ReportId[] {
  return [...new Set<ReportId>(page.sections.flatMap((s) => s.reports))];
}

// Every file in sections/ is a section. Vite reads the folder at build time, so a new report adds a file and
// edits no shared one. The server bundle never imports this file.
const modules = import.meta.glob<{ section?: ReportSection }>("./sections/*.tsx", { eager: true });

export const REPORT_SECTIONS: readonly ReportSection[] = Object.entries(modules)
  .map(([path, m]) => {
    if (!m.section) throw new Error(`${path} must export \`section\``);
    return m.section;
  })
  .sort((a, b) => a.order - b.order);

for (const [i, s] of REPORT_SECTIONS.entries()) {
  const clash = REPORT_SECTIONS.findIndex((o) => o.id === s.id);
  if (clash !== i) throw new Error(`two report sections use the id "${s.id}"`);
}

/** The sections of one page that have something to show for this answer, in page order. The nav and the cards both read this. */
export function visibleSections(ctx: ReportContext, page: SectionPage): ReportSection[] {
  return REPORT_SECTIONS.filter((s) => s.page === page && (s.visible?.(ctx) ?? true));
}

/** The core reports the sections of one page read: a page other than Raportit asks the server for these only. */
export function reportsOf(page: SectionPage): ReportId[] {
  return [...new Set(REPORT_SECTIONS.filter((s) => s.page === page).flatMap((s) => s.reports))];
}
