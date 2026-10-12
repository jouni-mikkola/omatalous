// Decision: how much to keep in the account for the bills before the pay, and for the ones after it
import { useState } from "react";
import { query } from "../../api.ts";
import { dayMonth, money } from "../../format.ts";
import type { DashboardData } from "../../types.ts";
import { windowLine, windowPayday } from "../next-days.ts";
import { BillForm } from "./BillForm.tsx";

type Ahead = NonNullable<DashboardData["ahead"]>;
type Row = Ahead["upcoming"][number];

const SHOWN = 10;

/**
 * The list in the groups of the window of Yhteenveto: what the accounts pay to the window's last day, the day before
 * the pay, under the line Yhteenveto has under its heading, then what they pay after it. So the first group's sum is the
 * bills of "Erääntyvät maksut" on Yhteenveto, which adds to them only a card's bill and an own transfer. A bill paid from
 * the pay on the payday itself (`withPay`) is after the pay. With no pay that ends the window there is one group. The
 * group to the pay stays without a row too: nothing due before the pay is an answer. The one after it does not, when
 * the pay is further than the list reaches. What a credit card is charged (`onCard`) leaves no account: it is the last
 * group, with a sum of its own, when there is any.
 */
function groupsOf(ahead: Ahead): { title: string; rows: Row[] }[] {
  const rows = ahead.upcoming.filter((r) => !r.onCard);
  const onCard = { title: "Kortilta veloitettavat", rows: ahead.upcoming.filter((r) => r.onCard) };
  const inWindow = (r: Row) => r.date <= ahead.to && !r.withPay;
  const before = { title: windowLine(ahead), rows: rows.filter(inWindow) };
  const after = { title: "Palkkapäivän jälkeen", rows: rows.filter((r) => !inWindow(r)) };
  const groups = !windowPayday(ahead) ? [{ title: "Seuraavat 30 päivää", rows }] : after.rows.length ? [before, after] : [before];
  return onCard.rows.length ? [...groups, onCard] : groups;
}

/**
 * Erääntyvät maksut on Laskut: the one list of what is charged in the next 30 days, to an account or to a credit card,
 * whether the bank history shows it every month, rarely, or the household typed it in. It is `upcoming` of the dashboard answer, found by the
 * same code as the rows of the block of the same name on Yhteenveto, and grouped by that block's window, each group with
 * its sum. "Lisää lasku" opens the form for a bill the history cannot know yet.
 */
export function Coming({ ahead, today, label, onAdded }: { ahead: Ahead | null; today: string; label: (id: string) => string; onAdded: () => void }) {
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const count = ahead?.upcoming.length ?? 0;
  const groups = ahead && count > 0 ? groupsOf(ahead) : [];
  // the first rows of the list as a whole; a group's sum is of all its rows
  const limit = all ? count : SHOWN;
  let before = 0;

  return (
    <div className="card" id="tulossa">
      <div className="card-head">
        <h2>Erääntyvät maksut</h2>
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
      {count === 0 ? (
        <p className="small muted">Ei laskuja seuraavan 30 päivän aikana.</p>
      ) : (
        <table className="compact coming-table">
          <caption className="sr-only">Maksut, jotka erääntyvät seuraavan 30 päivän aikana</caption>
          {groups.map((g) => {
            const shown = g.rows.slice(0, Math.max(0, limit - before));
            before += g.rows.length;
            return (
              <tbody key={g.title}>
                <tr className="group-head">
                  <th colSpan={2} scope="rowgroup">
                    {g.title}
                  </th>
                  <td className="num">{money(g.rows.reduce((sum, r) => sum - r.cents, 0))}</td>
                </tr>
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
            );
          })}
        </table>
      )}
      {count > SHOWN && (
        <button className="btn btn-small bills-more" type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Näytä vähemmän" : `Näytä kaikki (${count})`}
        </button>
      )}
    </div>
  );
}
