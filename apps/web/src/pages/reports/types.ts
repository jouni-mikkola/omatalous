import type { QuestionId, ReportId } from "@banking/core";
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
  /** The comparison the address names (`?compare=`), raw: a section that reads per-row figures for it asks `chosenKind`. */
  compare?: string | null;
  /** The name of the period the page shows ("12 kk"), so a figure that sums it can say so. Raportit sets it. */
  span?: string;
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
  /** The reports among `reports` whose figures stand for today and not for the period: a page whose sections list all they read here shows no period switch (`PERIOD_FREE_QUESTIONS`). */
  ofToday?: readonly ReportId[];
  /** Hidden when false: a section that has nothing to say leaves no card and no nav link. */
  visible?: (ctx: ReportContext) => boolean;
  /** On a page that folds its sections: starts open. */
  open?: boolean;
  Component: (props: SectionProps) => ReactNode;
}

/**
 * One question page of Raportit. A file in `pages/` exports it as `page`; `registry.ts` finds it, so a page task edits
 * its own file and no shared one. The frame (`Frame.tsx`) draws the question, the verdict, the comparison and the basis
 * from the page's `Conclusion` and the sections under them from `sections`.
 */
export interface ReportPage {
  id: QuestionId;
  /** The short name of the question where the list has no room for the question itself. */
  title: string;
  /** The sections shut under their name and summary figure, each opened by the reader (a page with more than the reader looks at in one visit). */
  fold?: boolean;
  /** The sections it shows, in `order`; each names the core reports it reads. */
  sections: readonly ReportSection[];
}
