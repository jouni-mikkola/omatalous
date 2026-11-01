// Decision: connect or fetch what is missing before trusting a number
// The notes about the data, as a card of the technical page of Asetukset.
import { type MissingCardPurchases } from "@banking/core";
import { date, money } from "../../format.ts";
import { query } from "../../api.ts";
import { filedLines } from "../../components/questions.ts";
import { t, tn } from "../../text.ts";
import { Table } from "../../components/table/Table.tsx";
import { CONNECT_BANK_HASH } from "../../routes.ts";
import type { Meta } from "../../types.ts";
import type { ReportContext } from "./types.ts";
import "../../styles/quality.css";

/** Why a card's purchases are not in the data, in a sentence. */
function reasonText(m: MissingCardPurchases): string {
  if (m.reason === "not_connected") return t("rpt.q_not_connected");
  if (m.reason === "before_history" && m.since) return t("rpt.q_since", { date: date(m.since) });
  return t("rpt.q_unmatched");
}

/** The bills that count as spending, by issuer: what they sum to over the range and why the purchases are not in the data. */
function CardPurchases({ rows }: { rows: readonly MissingCardPurchases[] }) {
  return (
    <Table
      caption={t("rpt.q_cards_caption")}
      className="card-purchases"
      rows={[...rows]}
      rowKey={(m) => `${m.issuer}|${m.reason}`}
      columns={[
        { key: "card", label: t("rpt.q_card"), kind: "text", rowHead: true, cell: (m) => m.label },
        { key: "bills", label: t("rpt.q_bills_12"), kind: "money", main: true, cell: (m) => money(m.cents) },
        { key: "why", label: t("rpt.q_why"), kind: "text", cell: (m) => reasonText(m) },
      ]}
    />
  );
}

type Refused = NonNullable<Meta["accounts"][number]["refused"]>;

/**
 * How many rows of an account's last fetch were not stored, and why, in a sentence; null when every row was. Unreadable
 * rows are missing from the figures; a twin is the same payment stored already from another source, so it is counted once.
 */
export function refusedLine(name: string, refused: Refused | null | undefined): string | null {
  const rows = (n: number) => tn(n, "rpt.q_row_one", "rpt.q_row_many");
  const why = [
    refused?.status && t(refused.status === 1 ? "rpt.q_status_one" : "rpt.q_status_many", { rows: rows(refused.status) }),
    refused?.amount && t("rpt.q_no_amount", { rows: refused.amount }),
    refused?.date && t("rpt.q_no_date", { rows: refused.date }),
  ].filter((w): w is string => !!w);
  const unread = (refused?.status ?? 0) + (refused?.amount ?? 0) + (refused?.date ?? 0);
  const twins = refused?.twin ?? 0;
  const parts: string[] = [];
  if (why.length) {
    const listed = why.length > 1 ? `${why.slice(0, -1).join(", ")}${t("rpt.and")}${why.at(-1)}` : why[0]!;
    parts.push(t("rpt.q_unread", { rows: rows(unread), list: listed }));
  }
  const skipped = twins === 1 ? t("rpt.q_row_acc_one") : rows(twins);
  if (twins) parts.push(t("rpt.q_twins", { lead: why.length ? t("rpt.q_twins_also", { rows: skipped }) : t("rpt.q_twins_last", { rows: skipped }), once: t(twins === 1 ? "rpt.q_twins_once_one" : "rpt.q_twins_once_many") }));
  return parts.length ? t("rpt.q_account_line", { name, parts: parts.join(" ") }) : null;
}

/** The sentences of the accounts whose last fetch left rows out. */
const refusedLines = (meta: Meta): { line: string; lost: boolean }[] =>
  meta.accounts.flatMap((a) => {
    const line = refusedLine(a.name, a.refused);
    return line ? [{ line, lost: !!(a.refused?.status || a.refused?.amount || a.refused?.date) }] : [];
  });

/** True while the data has a note to tell: a signal, the share filed without asking, or rows an account's last fetch left out. */
export const hasQualityNotes = (ctx: ReportContext): boolean => ctx.data.dataQuality.signals.length > 0 || !!ctx.data.dataQuality.filed || refusedLines(ctx.meta).length > 0;

export function QualityNotes({ ctx }: { ctx: ReportContext }) {
  const r = ctx.data.dataQuality;
  const lines = filedLines(r.filed);
  const refused = refusedLines(ctx.meta);
  return (
    <>
      {r.filed && (
        <div className="filed-share">
          <p>{lines[0]}</p>
          {lines.length > 1 && <p>{lines.slice(1).join(" ")}</p>}
        </div>
      )}
      <ul className="loans-notes">
        {refused.map(({ line, lost }) => (
          <li key={line} className="quality-note">
            <strong>{lost ? t("rpt.q_unstored") : t("rpt.q_skipped")}</strong>
            <div className="muted">{line}</div>
          </li>
        ))}
        {r.signals.map((s) => (
          <li key={s.id} className="quality-note">
            <strong>{s.title}</strong>
            {s.cardPurchases && <CardPurchases rows={s.cardPurchases} />}
            <div className={s.cardPurchases ? undefined : "muted"}>
              {s.cardPurchases ? s.cardPurchases.some((m) => m.reason === "not_connected") && <a href={CONNECT_BANK_HASH}>{t("rpt.q_connect_bank")}</a> : s.detail}
              {s.category && (
                <>
                  {" "}
                  <a href={`#/transactions${query({ category: s.category, from: ctx.range.from, to: ctx.range.to })}`}>{t("rpt.q_show_tx")}</a>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
