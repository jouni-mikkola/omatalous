import type { ReportId } from "@banking/core";
import type { ReportContext, ReportSection, SectionPage } from "./types.ts";

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
