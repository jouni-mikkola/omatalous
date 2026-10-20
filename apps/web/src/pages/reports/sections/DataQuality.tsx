// Decision: connect or fetch what is missing before trusting a number
// It is a card of the technical page of Asetukset, drawn only while the data has a note.
import { formatEur, formatFiDate, type MissingCardPurchases } from "@banking/core";
import { query } from "../../../api.ts";
import { filedLines } from "../../../components/questions.ts";
import { DataTable } from "../../../components/table/DataTable.tsx";
import { Section } from "../../../components/Section.tsx";
import type { Meta } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/quality.css";

/** Why a card's purchases are not in the data, in a sentence. */
function reasonText(m: MissingCardPurchases): string {
  if (m.reason === "not_connected") return "Korttia ei ole yhdistetty.";
  if (m.reason === "before_history" && m.since) return `Pankki antaa ostot vasta ${formatFiDate(m.since)} alkaen.`;
  return "Laskut eivät vastaa kortin tapahtumia.";
}

/** The bills that count as spending, by issuer: what they sum to over the range and why the purchases are not in the data. */
function CardPurchases({ rows }: { rows: readonly MissingCardPurchases[] }) {
  return (
    <DataTable
      id="card-purchases"
      caption="Kortit, joiden ostot puuttuvat"
      className="card-purchases"
      rows={[...rows]}
      rowKey={(m) => `${m.issuer}|${m.reason}`}
      columns={[
        { key: "card", label: "Kortti", kind: "text", rowHead: true, cell: (m) => m.label },
        { key: "bills", label: "Laskut 12 kuukaudelta", kind: "money", main: true, cell: (m) => formatEur(m.cents) },
        { key: "why", label: "Miksi ostot puuttuvat", kind: "text", cell: (m) => reasonText(m) },
      ]}
    />
  );
}

type Refused = NonNullable<Meta["accounts"][number]["refused"]>;

/** How many rows of an account's last fetch were left out, and why, in a sentence; null when none were. */
export function refusedLine(name: string, refused: Refused | null | undefined): string | null {
  const rows = (n: number) => `${n} ${n === 1 ? "rivi" : "riviä"}`;
  const why = [
    refused?.status && `${rows(refused.status)}, ${refused.status === 1 ? "jonka" : "joiden"} tila on tuntematon`,
    refused?.amount && `${refused.amount} ilman luettavaa summaa`,
    refused?.date && `${refused.date} ilman päivämäärää`,
  ].filter((w): w is string => !!w);
  if (!why.length) return null;
  const count = (refused!.status ?? 0) + (refused!.amount ?? 0) + (refused!.date ?? 0);
  const listed = why.length > 1 ? `${why.slice(0, -1).join(", ")} ja ${why.at(-1)}` : why[0];
  return `${name}: viime haussa ${rows(count)} jäi lukematta: ${listed}. Ne puuttuvat luvuista.`;
}

/** The sentences of the accounts whose last fetch left rows out. */
const refusedLines = (meta: Meta): string[] => meta.accounts.flatMap((a) => refusedLine(a.name, a.refused) ?? []);

function DataQuality({ ctx }: SectionProps) {
  const r = ctx.data.dataQuality;
  const lines = filedLines(r.filed);
  const refused = refusedLines(ctx.meta);
  return (
    <Section id={section.id} title={section.title}>
      {r.filed && (
        <div className="filed-share">
          <p>{lines[0]}</p>
          {lines.length > 1 && <p>{lines.slice(1).join(" ")}</p>}
        </div>
      )}
      <ul className="loans-notes">
        {refused.map((line) => (
          <li key={line} style={{ margin: "0 0 10px" }}>
            <strong>Osa tapahtumista jäi lukematta</strong>
            <div className="muted">{line}</div>
          </li>
        ))}
        {r.signals.map((s) => (
          <li key={s.id} style={{ margin: "0 0 10px" }}>
            <strong>{s.title}</strong>
            {s.cardPurchases && <CardPurchases rows={s.cardPurchases} />}
            <div className={s.cardPurchases ? undefined : "muted"}>
              {s.cardPurchases ? s.cardPurchases.some((m) => m.reason === "not_connected") && <a href="#/settings?add=1">Yhdistä pankki</a> : s.detail}
              {s.category && (
                <>
                  {" "}
                  <a href={`#/transactions${query({ category: s.category, from: ctx.range.from, to: ctx.range.to })}`}>Näytä tapahtumat</a>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export const section: ReportSection = {
  id: "laatu",
  title: "Tietojen laatu",
  order: 10,
  page: "settings",
  reports: ["dataQuality"],
  // no note and no spending, no card
  visible: (ctx) => ctx.data.dataQuality.signals.length > 0 || !!ctx.data.dataQuality.filed || refusedLines(ctx.meta).length > 0,
  Component: DataQuality,
};
