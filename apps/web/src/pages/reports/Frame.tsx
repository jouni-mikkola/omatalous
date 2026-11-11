// Decision: which report of Lisää to open, and what the household should do about the one open
import { type CompareKind, type ConclusionsReport, type QuestionId, QUESTIONS } from "@banking/core";
import { type ReactNode, useState } from "react";
import { query } from "../../api.ts";
import { t } from "../../text.ts";
import { navigate } from "../../hooks.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import { Basis } from "./Basis.tsx";
import { Compare, chosenKind } from "./Compare.tsx";
import { Notices, Recommendation, Verdict } from "./Verdict.tsx";
import { TAX_YEAR_ID, YEARS_ID } from "./sections/ids.ts";
import type { ReportContext, ReportPage } from "./types.ts";
import "../../styles/reports.css";

/** The questions that have something to say, in the order of the list. */
export const openQuestions = (conclusions: ConclusionsReport): QuestionId[] => QUESTIONS.filter((id) => conclusions[id] !== null);

/** What Lisää lists: the reports that earn a place, each at the question page that holds it and, for a part of a page, its section. */
const MORE_LINKS: readonly { id: string; label: () => string; q: QuestionId; anchor?: string }[] = [
  { id: "vuosi", label: () => t("rpt.more_year"), q: "menot", anchor: YEARS_ID },
  { id: "tilit", label: () => t("rpt.more_accounts"), q: "saldot" },
  { id: "lainat", label: () => t("rpt.more_loans"), q: "velat" },
  { id: "verovuosi", label: () => t("rpt.more_tax"), q: "tulot", anchor: TAX_YEAR_ID },
  { id: "yhteiset", label: () => t("rpt.more_shared"), q: "yhteiset" },
];

/** Lisää: the list of the reports that have something to say (Yhteiset only with a shared account), the open one marked. On a phone it folds behind "Lisää". */
function MoreList({ conclusions, current, params }: { conclusions: ConclusionsReport; current: QuestionId; params: URLSearchParams }) {
  const [open, setOpen] = useState(false);
  return (
    <nav className={open ? "q-rail open" : "q-rail"} aria-label={t("rpt.more")}>
      <button type="button" className="q-switch" aria-expanded={open} aria-controls="q-list" onClick={() => setOpen(!open)}>
        {t("rpt.more")}
      </button>
      <ol id="q-list" className="q-list">
        {MORE_LINKS.filter((l) => conclusions[l.q] !== null).map((l) => (
          <li key={l.id}>
            <a href={`#/reports${query({ q: l.q, period: params.get("period"), compare: params.get("compare") })}${l.anchor ? `#${l.anchor}` : ""}`} aria-current={!l.anchor && l.q === current ? "page" : undefined} onClick={() => setOpen(false)}>
              {l.label()}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The frame of every question page: the list of Lisää, the open one as a heading with its verdict, the switch of the
 * comparison, the one recommendation, the sections the page assembled and the basis. The comparison and the question are
 * in the address, so a link keeps them.
 */
export function Frame({ ctx, page, conclusions, params, note, children }: { ctx: ReportContext; page: ReportPage; conclusions: ConclusionsReport; params: URLSearchParams; note?: string; children: ReactNode }) {
  const conclusion = conclusions[page.id]!;
  const kind: CompareKind | null = chosenKind(conclusion, params.get("compare"));
  return (
    <div className="q-frame">
      <MoreList conclusions={conclusions} current={page.id} params={params} />
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
