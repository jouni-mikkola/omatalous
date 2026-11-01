// Decision: connect or fetch what is missing before trusting a number
// It is a card of the technical page of Asetukset, drawn only while the data has a note; Peruste of a question in Raportit links to it.
import { Section } from "../../../components/Section.tsx";
import { hasQualityNotes, QualityNotes } from "../quality.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";

function DataQuality({ ctx }: SectionProps) {
  return (
    <Section id={section.id} title={section.title}>
      <QualityNotes ctx={ctx} />
    </Section>
  );
}

export const section: ReportSection = {
  id: "laatu",
  get title() {
    return t("rpt.sec_dataquality");
  },
  order: 10,
  page: "settings",
  reports: ["dataQuality"],
  // no note and no spending, no card
  visible: hasQualityNotes,
  Component: DataQuality,
};
