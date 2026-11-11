// Decision: which report of Lisää to open
import type { QuestionId } from "@banking/core";
import { type ReactNode, useState } from "react";
import { query } from "../../api.ts";
import { t } from "../../text.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import { TAX_YEAR_ID, YEARS_ID } from "./sections/ids.ts";
import type { ReportPage } from "./types.ts";
import "../../styles/reports.css";

/** What Lisää lists: the reports that earn a place, each at the question page that holds it and, for a part of a page, its section. */
const MORE_LINKS: readonly { id: string; label: () => string; q: QuestionId; anchor?: string }[] = [
  { id: "vuosi", label: () => t("rpt.more_year"), q: "menot", anchor: YEARS_ID },
  { id: "tilit", label: () => t("rpt.more_accounts"), q: "saldot" },
  { id: "lainat", label: () => t("rpt.more_loans"), q: "velat" },
  { id: "verovuosi", label: () => t("rpt.more_tax"), q: "tulot", anchor: TAX_YEAR_ID },
  { id: "yhteiset", label: () => t("rpt.more_shared"), q: "yhteiset" },
];

/** Lisää: the list of the reports whose page has something to show (Yhteiset only with a shared account), the open one marked. On a phone it folds behind "Lisää". */
function MoreList({ pages, current, params }: { pages: readonly ReportPage[]; current: QuestionId; params: URLSearchParams }) {
  const [open, setOpen] = useState(false);
  return (
    <nav className={open ? "q-rail open" : "q-rail"} aria-label={t("rpt.more")}>
      <button type="button" className="q-switch" aria-expanded={open} aria-controls="q-list" onClick={() => setOpen(!open)}>
        {t("rpt.more")}
      </button>
      <ol id="q-list" className="q-list">
        {MORE_LINKS.filter((l) => pages.some((p) => p.id === l.q)).map((l) => (
          <li key={l.id}>
            <a href={`#/reports${query({ q: l.q, period: params.get("period") })}${l.anchor ? `#${l.anchor}` : ""}`} aria-current={!l.anchor && l.q === current ? "page" : undefined} onClick={() => setOpen(false)}>
              {l.label()}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The frame of every question page: the list of Lisää, the open one as a heading and the sections the page assembled. The question is in the address, so a link keeps it. */
export function Frame({ page, pages, params, note, children }: { page: ReportPage; pages: readonly ReportPage[]; params: URLSearchParams; note?: string; children: ReactNode }) {
  return (
    <div className="q-frame">
      <MoreList pages={pages} current={page.id} params={params} />
      <div className="q-page stack">
        <header className="q-head">
          <h2 className="q-title">{page.title}</h2>
          {note && <Notice>{note}</Notice>}
        </header>
        {children}
      </div>
    </div>
  );
}
