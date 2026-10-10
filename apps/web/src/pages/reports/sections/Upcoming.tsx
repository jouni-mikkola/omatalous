import { query } from "../../../api.ts";
import { CADENCE_LABEL, date, money } from "../../../format.ts";
import { Section } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/** Quarterly and yearly bills in the next three months: the ones that slip the mind. */
function Upcoming({ ctx }: SectionProps) {
  const r = ctx.data.upcoming;
  return (
    <Section section={section} sub={`${date(r.from)}–${date(r.to)}`}>
      <p className="lead">{r.advice}</p>
      <div className="table-wrap">
        <table className="compact">
          <tbody>
            {r.items.map((i) => (
              <tr key={`${i.merchant}-${i.date}`}>
                <td style={{ whiteSpace: "nowrap" }}>{date(i.date)}</td>
                <td>
                  <a href={`#/transactions${query({ merchant: i.merchant })}`}>{i.merchant}</a>
                  <div className="sub">
                    {ctx.label(i.category)} · {CADENCE_LABEL[i.cadence]}
                  </div>
                </td>
                <td className="num">
                  <strong>{money(i.amountCents, false)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export const section: ReportSection = {
  id: "tulevat",
  title: "Tulevat laskut",
  order: 70,
  reports: ["upcoming"],
  visible: (ctx) => ctx.data.upcoming.items.length > 0,
  Component: Upcoming,
};
