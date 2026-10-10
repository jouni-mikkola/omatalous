import { query } from "../../../api.ts";
import { date, money } from "../../../format.ts";
import { Section } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

const LARGEST_SHOWN = 10;
const NEW_SHOWN = 8;

/** One-off purchases worth remembering, and places the household started using in the period. */
function Purchases({ ctx }: SectionProps) {
  const r = ctx.data.highlights;
  return (
    <Section section={section} sub="Ilman kiinteitä kuluja ja ruokakauppaa">
      <div className="grid two">
        <div className="table-wrap">
          <table>
            <tbody>
              {r.largest.slice(0, LARGEST_SHOWN).map((t) => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{date(t.date)}</td>
                  <td>
                    <a href={`#/transactions${query({ merchant: t.merchant })}`}>{t.merchant}</a>
                    <div className="sub">{ctx.label(t.category)}</div>
                  </td>
                  <td className="num">
                    <strong>{money(t.cents)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!r.largest.length && <div className="empty">Ei ostoksia valitulla jaksolla.</div>}
        </div>
        <div className="table-wrap">
          <h3 className="small muted">Uudet kauppiaat, vähintään kaksi ostosta</h3>
          <table>
            <tbody>
              {r.newMerchants.slice(0, NEW_SHOWN).map((m) => (
                <tr key={m.merchant}>
                  <td>
                    <a href={`#/transactions${query({ merchant: m.merchant })}`}>{m.merchant}</a>
                    <div className="sub">
                      {ctx.label(m.category)} · ensimmäinen {date(m.firstDate)}
                    </div>
                  </td>
                  <td className="num">{m.count} kpl</td>
                  <td className="num">{money(m.totalCents, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!r.newMerchants.length && <div className="empty">Ei uusia kauppiaita.</div>}
        </div>
      </div>
    </Section>
  );
}

export const section: ReportSection = {
  id: "ostot",
  title: "Suurimmat ostot",
  order: 100,
  reports: ["highlights"],
  Component: Purchases,
};
