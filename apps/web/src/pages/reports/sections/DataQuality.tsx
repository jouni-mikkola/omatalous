// Decision: connect or fetch what is missing before trusting a number
// It is a card of the technical page of Asetukset, drawn only while the data has a note.
import { formatEur, formatFiDate, type MissingCardPurchases } from "@banking/core";
import { query } from "../../../api.ts";
import { filedLines } from "../../../components/questions.ts";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/quality.css";

/** The bills that count as spending, by issuer: what they sum to over the range and why the purchases are not in the data. */
function CardPurchases({ rows }: { rows: readonly MissingCardPurchases[] }) {
  return (
    <table className="st-table card-purchases">
      <thead>
        <tr>
          <th scope="col">Kortti</th>
          <th scope="col" className="st-num">
            Laskut 12 kuukaudelta
          </th>
          <th scope="col">Miksi ostot puuttuvat</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={`${m.issuer}|${m.reason}`}>
            <th scope="row">{m.label}</th>
            <td className="st-num" data-label="Laskut 12 kuukaudelta">
              {formatEur(m.cents)}
            </td>
            <td data-label="Miksi ostot puuttuvat">{m.reason === "before_history" && m.since ? `Pankki antaa ostot vasta ${formatFiDate(m.since)} alkaen.` : "Korttia ei ole yhdistetty."}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DataQuality({ ctx }: SectionProps) {
  const r = ctx.data.dataQuality;
  const lines = filedLines(r.filed);
  return (
    <Section id={section.id} title={section.title}>
      {r.filed && (
        <div className="filed-share">
          <p>{lines[0]}</p>
          {lines.length > 1 && <p>{lines.slice(1).join(" ")}</p>}
        </div>
      )}
      <ul className="loans-notes">
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
  visible: (ctx) => ctx.data.dataQuality.signals.length > 0 || !!ctx.data.dataQuality.filed,
  Component: DataQuality,
};
