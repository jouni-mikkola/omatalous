// Decision: is this month's difference from the usual one a reason to act, and where
import { signedMoney } from "../../format.ts";
import type { ReportsData } from "../../types.ts";
import { barShare } from "../table/cells.ts";
import "../../styles/overview.css";

type View = ReportsData["spendingChange"]["views"][number];

/**
 * Miksi kuu poikkeaa tavallisesta: the spending change report's usual view for the running month. Its sentence, then
 * each category that moved as a bar from the middle (up is more than usual, down less), its cause under the name and
 * the rest last; the bars add up to the change on the server. The lengths are the only thing worked out here. A quiet
 * month says so in one sentence, with no axis.
 */
export function Differs({ view }: { view: View }) {
  const max = view.bars.reduce((m, b) => Math.max(m, Math.abs(b.cents)), 0);
  return (
    <section className="card differs" aria-labelledby="differs-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="differs-h">Miksi kuu poikkeaa tavallisesta</h2>
          <p className="card-sub pace-answer">{view.sentence}</p>
        </div>
      </div>
      {view.bars.length > 0 ? (
        <>
          <ol className="differs-rows">
            {view.bars.map((b) => {
              const up = b.cents > 0;
              const width = `${(barShare(b.cents, max) * 50).toFixed(1)}%`;
              return (
                <li key={b.label} className={`differs-row ${b.kind === "rest" ? "differs-rest" : up ? "differs-up" : "differs-down"}`}>
                  <span className="differs-name">
                    {b.label}
                    {b.cause && <span className="differs-cause">{b.cause}</span>}
                  </span>
                  <span className="differs-track" aria-hidden="true">
                    <span className="differs-bar" style={up ? { left: "50%", width } : { right: "50%", width }} />
                  </span>
                  <span className="num differs-fig">
                    <span aria-hidden="true">{up ? "↑ " : "↓ "}</span>
                    {signedMoney(b.cents)}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="differs-axis" aria-hidden="true">
            <span>vähemmän kuin tavallisesti</span>
            <span>enemmän</span>
          </div>
        </>
      ) : (
        <p className="differs-quiet">Mikään luokka ei poikkea tavallisesta niin, että se erottuisi kuukausien vaihtelusta.</p>
      )}
    </section>
  );
}
