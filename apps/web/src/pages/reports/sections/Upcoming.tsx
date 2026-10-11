// Decision: how much to set aside each month for rare bills
import { useState } from "react";
import { api } from "../../../api.ts";
import { cadenceLabel } from "../../../components/bills/BillForm.tsx";
import { date, money, monthLong } from "../../../format.ts";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/bills.css";

/**
 * Rare bills: what to set aside each month, what falls due in each of the next twelve months, and the bills the
 * household typed in, which can be removed here. A bill is found after two charges, so a yearly one is typed in
 * (Tulossa > Lisää lasku) for its first two years. The bills of the next 30 days are in Tulossa, not here.
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

  const biggest = Math.max(1, ...r.months.map((m) => m.cents));
  return (
    <Section id={section.id} title={section.title}>
      {r.advice && (
        <>
          <p className="lead">{r.advice}</p>

          <h3 className="bills-head">Seuraavat 12 kuukautta</h3>
          <ul className="bill-months">
            {r.months.map((m) => (
              <li key={m.month}>
                <div className="bill-month-head">
                  <span>{monthLong(m.month)}</span>
                  <strong>{m.cents ? money(m.cents, false) : "–"}</strong>
                </div>
                {m.cents > 0 && (
                  <div className="bill-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, (m.cents / biggest) * 100)}%` }} />
                  </div>
                )}
                {m.names.length > 0 && <div className="sub">{m.names.join(", ")}</div>}
              </li>
            ))}
          </ul>
        </>
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
  // nothing rare found and nothing typed in: Tulossa has the form, and the sentence on what is found is in it
  visible: (ctx) => ctx.data.upcoming.advice !== "" || ctx.data.upcoming.manual.length > 0,
  Component: Upcoming,
};
