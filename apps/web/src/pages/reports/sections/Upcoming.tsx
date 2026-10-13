// Decision: how much to set aside each month for rare bills
import { useState } from "react";
import { api } from "../../../api.ts";
import { cadenceLabel } from "../../../components/bills/BillForm.tsx";
import { Figure } from "../../../components/Figure.tsx";
import { date, dayMonth, money, monthLong } from "../../../format.ts";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/bills.css";
import "../../../styles/statement.css";

/**
 * Rare bills: what to set aside each month, in the datum of the heading; the months of the next twelve that have bills,
 * as a table of the month, its payees and its sum (a bill paid this month is marked with its day); and the bills the
 * household typed in, which can be removed here. A bill is found after two charges, so a yearly one is typed in
 * (Erääntyvät maksut > Lisää lasku) for its first two years. The bills of the next 30 days are in Erääntyvät maksut, not here.
 */
function Upcoming({ ctx }: SectionProps) {
  const r = ctx.data.upcoming;
  const [error, setError] = useState<string | null>(null);

  const remove = async (id: string) => {
    setError(null);
    try {
      await api(`/api/expected-bills/${encodeURIComponent(id)}`, { method: "DELETE" });
      ctx.reload?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // a month without bills says nothing; the year still counts all twelve
  const months = r.months.filter((m) => m.cents > 0);
  return (
    <Section id={section.id} title={section.title} datum={r.yearlyCents > 0 ? <Figure text={`${money(r.reserveMonthlyCents, false)}/kk`} size="s" /> : undefined}>
      {r.yearlyCents > 0 && (
        <table className="st-table rare-table">
          <caption className="sr-only">Seuraavat 12 kuukautta</caption>
          <thead>
            <tr>
              <th scope="col" className="due-col">
                Eräpäivä
              </th>
              <th scope="col">Saaja</th>
              <th scope="col" className="st-num">
                Summa
              </th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <td className="due-col">{monthLong(m.month)}</td>
                <td>{m.names.join(", ")}</td>
                <td className="st-num">{money(m.cents, false)}</td>
                <td>
                  {m.paid.map((p) => (
                    <div key={`${p.merchant}-${p.date}`}>
                      Maksettu {dayMonth(p.date)}
                      {m.paid.length > 1 && ` (${p.merchant})`}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {r.manual.length > 0 && (
        <>
          <h3 className="bills-head">Lisäämäsi laskut</h3>
          <ul className="bill-list">
            {r.manual.map((b) => (
              <li key={b.id}>
                <div className="bill-line">
                  <span className="bill-name">{b.name}</span>
                  <strong>{money(b.amountCents)}</strong>
                  <button className="btn btn-small btn-danger" type="button" aria-label={`Poista lasku ${b.name}`} onClick={() => remove(b.id)}>
                    Poista
                  </button>
                </div>
                <div className="sub">
                  {cadenceLabel(b.cadence)} · {b.nextDate ? `seuraava ${date(b.nextDate)}` : `erääntyi ${date(b.dueDate)}`}
                </div>
                {!b.counted && <div className="sub">Tunnistettu jo tapahtumista, lasketaan vain kerran.</div>}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </Section>
  );
}

export const section: ReportSection = {
  id: "tulevat",
  title: "Harvinaiset laskut",
  // after Sopimukset ja laskut on the page (the numbers are shared with the cards of pages/Bills.tsx)
  order: 50,
  page: "bills",
  reports: ["upcoming"],
  // nothing rare found and nothing typed in: Erääntyvät maksut has the form
  visible: (ctx) => ctx.data.upcoming.yearlyCents > 0 || ctx.data.upcoming.manual.length > 0,
  Component: Upcoming,
};
