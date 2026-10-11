import type { ReportId } from "@banking/core";
import type { ReactNode } from "react";
import type { Meta, ReportsData, Scope } from "../../types.ts";

export type ReportRange = { from: string; to: string };

/** What every section may read. The page builds it once per answer from the server. */
export interface ReportContext {
  data: ReportsData;
  meta: Meta;
  range: ReportRange;
  scope: Scope;
  /** The month that has not ended yet, marked in the tables. */
  running: string | null;
  /** Display name of a category id. */
  label: (categoryId: string) => string;
  /** Address of the CSV export of one core report for the shown range and scope. */
  exportHref: (report: ReportId) => string;
  /** Fetches the page's answer again after a section changed what the reports read (a typed-in bill). Pages that do not offer that leave it out. */
  reload?: () => void;
}

export interface SectionProps {
  ctx: ReportContext;
}

/** The pages a section can be shown on: the page ids of 0.8.4's structure, so moving a section is a one-word change. */
export type SectionPage = "month" | "bills" | "reports" | "optimise" | "settings";

/**
 * One block of a page. A file in `sections/` exports it as `section`; `registry.ts` finds it, so the nav and the
 * render list need no edit. The repo rules check that every core report is read by some section.
 */
export interface ReportSection {
  /** Anchor id of the card and target of its nav link. */
  id: string;
  /** Heading of the card and text of its nav link. */
  title: string;
  /** Position on the page, low first. Leave gaps of 10. */
  order: number;
  /** The page that renders it. Raportit shows `reports`; a page renders only its own sections. */
  page: SectionPage;
  /** The core reports (packages/core/src/reports) this section reads. */
  reports: readonly ReportId[];
  /** Hidden when false: a section that has nothing to say leaves no card and no nav link. */
  visible?: (ctx: ReportContext) => boolean;
  Component: (props: SectionProps) => ReactNode;
}
