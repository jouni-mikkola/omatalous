// Decision: connect or fetch what is missing before trusting a number
// It is a card of the technical page of Asetukset, drawn only while the data has a note.
import { query } from "../../../api.ts";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/quality.css";

function DataQuality({ ctx }: SectionProps) {
  const r = ctx.data.dataQuality;
  return (
    <Section id={section.id} title={section.title}>
      <ul className="loans-notes">
        {r.signals.map((s) => (
          <li key={s.id} style={{ margin: "0 0 10px" }}>
            <strong>{s.title}</strong>
            <div className="muted">
              {s.detail}
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
  // no note, no card
  visible: (ctx) => ctx.data.dataQuality.signals.length > 0,
  Component: DataQuality,
};
