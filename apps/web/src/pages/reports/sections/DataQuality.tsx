// Decision: connect or fetch what is missing before trusting a number
// It sits in Asetukset > Tilit, under the accounts and their last fetch, which it used to repeat in a table of its own.
import { query } from "../../../api.ts";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/quality.css";

function DataQuality({ ctx }: SectionProps) {
  const r = ctx.data.dataQuality;
  return (
    <Section id={section.id} title={section.title} sub="Näissä kohdissa luvut voivat poiketa todellisesta." nested>
      {r.signals.length ? (
        <ul className="plain">
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
      ) : (
        <p className="muted">Ei huomautettavaa.</p>
      )}
    </Section>
  );
}

export const section: ReportSection = {
  id: "laatu",
  title: "Tietojen laatu",
  order: 10,
  page: "settings",
  reports: ["dataQuality"],
  // no accounts, nothing to be unsure about: Tilit says what to add
  visible: (ctx) => ctx.meta.accounts.length > 0,
  Component: DataQuality,
};
