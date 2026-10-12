// Decision: does the account cover what is due before the next pay
import { query } from "../api.ts";
import { money } from "../format.ts";
import { SETTINGS_ANCHOR } from "../routes.ts";
import "../styles/ahead.css";
import "../styles/statement.css";
import { type Ahead, figures, incoming, payments, paymentsCaption, warning, windowLine } from "./next-days.ts";

type Line = ReturnType<typeof payments>[number];

/**
 * What is due before the next pay, as a statement of two groups: at the left the balance, the payments of the window
 * and what is left, under the line that names the window; at the right the payments one by one and the pay that is to
 * arrive. Nothing is modelled. Laskut lists the same payments for 30 days and lets a bill be added.
 */
export function NextDays({ ahead }: { ahead: Ahead }) {
  const three = figures(ahead);
  const short = warning(ahead);
  const due = payments(ahead);
  const coming = incoming(ahead);

  return (
    <section className="card st-block" aria-labelledby="ahead-h">
      <div className="card-head">
        <h2 id="ahead-h">Erääntyvät maksut</h2>
      </div>
      {short && <p className="notice warning ahead-warning">{short}</p>}
      <div className="st-cols st-cols-3">
        <div>
          <h3 className="st-cap ahead-window">{windowLine(ahead)}</h3>
          {three ? (
            <dl className="st-rows">
              {three.map((f) => (
                <div key={f.key} className={f.key === "free" ? "st-row st-total" : "st-row"}>
                  <dt className="st-name">{f.label}</dt>
                  <dd className="st-num">{money(f.cents)}</dd>
                  {f.notes.map((note) => (
                    <dd key={note} className="st-sub">
                      {note}
                    </dd>
                  ))}
                </div>
              ))}
            </dl>
          ) : (
            <p className="ahead-missing">
              Tilin saldo ei ole tiedossa. <a href={`#/settings#${SETTINGS_ANCHOR.accounts}`}>Lisää saldo</a>
            </p>
          )}
        </div>
        <div className="st-wide">
          <Lines caption={paymentsCaption(ahead)} hidden head={["Eräpäivä", "Saaja"]} lines={due} />
          {due.length > 0 && <p className="st-note">Eräpäivät ja summat ovat arvioita.</p>}
          {coming.length > 0 && <Lines caption="Saapuvat maksut" head={["Päivä", "Maksaja"]} lines={coming} />}
          <p className="st-links">
            <a href="#/bills">Laskut</a>
            <a href="#/bills">Lisää lasku</a>
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * One of the two tables: the day, the name with the line under it, the sum. A caption the block's heading already says
 * is for a screen reader only. A table with no line says so in its one row.
 */
function Lines({ caption, hidden = false, head, lines }: { caption: string; hidden?: boolean; head: [string, string]; lines: Line[] }) {
  return (
    <table className="st-table ahead-table">
      <caption className={hidden ? "sr-only" : "st-cap"}>{caption}</caption>
      <colgroup>
        <col className="ahead-day" />
        <col />
        <col className="ahead-sum" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{head[0]}</th>
          <th scope="col">{head[1]}</th>
          <th scope="col" className="st-num">
            Summa
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={`${l.day}-${l.name}-${i}`}>
            <td>{l.day}</td>
            <td title={l.name}>
              {l.merchant ? <a href={`#/transactions${query({ merchant: l.merchant })}`}>{l.name}</a> : l.name}
              {l.note && <div className="st-sub">{l.note}</div>}
            </td>
            <td className="st-num">{money(l.cents)}</td>
          </tr>
        ))}
        {lines.length === 0 && (
          <tr>
            <td colSpan={3}>Ei erääntyviä maksuja.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
