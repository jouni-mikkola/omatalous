import { query } from "../../../api.ts";
import { Section } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

function DataQuality({ ctx }: SectionProps) {
  const r = ctx.data.dataQuality;
  return (
    <Section section={section} sub="Näissä kohdissa luvut voivat poiketa todellisesta.">
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
    </Section>
  );
}

export const section: ReportSection = {
  id: "laatu",
  title: "Tietojen laatu",
  order: 10,
  reports: ["dataQuality"],
  visible: (ctx) => ctx.data.dataQuality.signals.length > 0,
  Component: DataQuality,
};
