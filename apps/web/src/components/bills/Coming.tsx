// Decision: how much to keep in the account for the bills of the next 30 days
import { useState } from "react";
import { query } from "../../api.ts";
import { dayMonth, money, plural } from "../../format.ts";
import type { DashboardData } from "../../types.ts";
import { BillForm } from "./BillForm.tsx";

type Ahead = NonNullable<DashboardData["ahead"]>;

const SHOWN = 10;

/**
 * Tulossa: the one list of what leaves the account in the next 30 days, whether the bank history shows it every month,
 * rarely, or the household typed it in. It is `upcoming` of the dashboard answer, found by the same code as the rows of the
 * card on Kuukausi, which lists the first part of it, to the payday. The count and the sum come from this list.
 * "Lisää lasku" opens the form for a bill the history cannot know yet.
 */
export function Coming({ ahead, today, label, onAdded }: { ahead: Ahead | null; today: string; label: (id: string) => string; onAdded: () => void }) {
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const rows = ahead?.upcoming ?? [];
  const shown = all ? rows : rows.slice(0, SHOWN);
  const total = rows.reduce((sum, r) => sum - r.cents, 0);

  return (
    <div className="card" id="tulossa">
      <div className="card-head">
        <div>
          <h2>Tulossa</h2>
          <div className="card-sub">Seuraavat 30 päivää{rows.length > 0 ? `, ${plural(rows.length, "maksu", "maksua")}` : ""}</div>
        </div>
        <div className="coming-total">
          {rows.length > 0 && <strong>{money(total, false)}</strong>}
          <button
            className="btn btn-small"
            type="button"
            aria-expanded={adding}
            onClick={() => {
              setAdding((v) => !v);
              setAdded(null);
            }}
          >
            {adding ? "Peruuta" : "Lisää lasku"}
          </button>
        </div>
      </div>
      {adding && (
        <BillForm
          today={today}
          onAdded={(name) => {
            setAdding(false);
            setAdded(name);
            onAdded();
          }}
        />
      )}
      {added && (
        <p className="small muted" role="status">
          Lasku {added} lisätty.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="small muted">Ei laskuja seuraavan 30 päivän aikana.</p>
      ) : (
        <table className="compact">
          <caption className="sr-only">Maksut, jotka erääntyvät seuraavan 30 päivän aikana</caption>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.date}-${r.name}-${i}`}>
                <td>
                  {r.source === "expected" ? (
                    <>
                      {r.name} <span className="badge">lisätty käsin</span>
                    </>
                  ) : (
                    <a href={`#/transactions${query({ merchant: r.name })}`}>{r.name}</a>
                  )}
                  {r.category && <div className="sub">{label(r.category)}</div>}
                </td>
                <td className="num muted">{dayMonth(r.date)}</td>
                <td className="num">{money(-r.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > SHOWN && (
        <button className="btn btn-small bills-more" type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Näytä vähemmän" : `Näytä kaikki (${rows.length})`}
        </button>
      )}
    </div>
  );
}
