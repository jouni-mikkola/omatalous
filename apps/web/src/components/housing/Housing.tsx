/**
 * Decision: what the home costs a month, and whether the household has a home loan to add. Yhteenveto shows it as the
 * block Asuminen, a statement: the table Lainat with the terms the household typed, one row a loan; under it the table
 * Asumiskulut, one row a charge, beside the sums. Every figure is the one in `housing` (the answer Yhteenveto already
 * loads); nothing here adds anything up. A household with no home loan and no rent is asked for one in the table's
 * place, and the answer is stored as a mark of the signed-in member.
 */
import { MORTGAGE_QUESTION } from "@banking/core";
import { type CSSProperties, Fragment, useState } from "react";
import { api, query } from "../../api.ts";
import { money } from "../../format.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import type { DashboardData } from "../../types.ts";
import { DASH, housingView, LOAN_COLUMNS } from "./housing.ts";
import "../../styles/statement.css";
import "../../styles/housing.css";

const SETTINGS_LOANS = `#/settings#${SETTINGS_ANCHOR.loans}`;
const NEXT_PAYMENT = "Seuraava maksuerä";
const paymentsOf = (payee: string) => `#/transactions${query({ merchant: payee })}`;

type View = ReturnType<typeof housingView>;

/**
 * The table Lainat. From 1040 px it is a table with a head; below that each loan is a grid of the same labels and
 * values (housing.css), so every cell carries its label and the group head of the next payment for that form.
 */
function Loans({ rows, reportAnchor }: { rows: View["loans"]; reportAnchor: string }) {
  // the column of the links is there only when a row has one: without it the months stand on the block's right edge
  const linked = rows.some((row) => row.link !== null);
  return (
    <div className="st-part">
      <h3 className="st-cap" id="housing-loans-h">
        Lainat
      </h3>
      <table className="st-table housing-loans" aria-labelledby="housing-loans-h">
        <thead>
          <tr>
            <th scope="col" rowSpan={2}>
              Laina
            </th>
            {LOAN_COLUMNS.filter((c) => !c.next && c.key !== "month").map((c) => (
              <th key={c.key} scope="col" rowSpan={2} className={c.figure ? "st-num" : undefined}>
                {c.head}
              </th>
            ))}
            <th scope="colgroup" colSpan={LOAN_COLUMNS.filter((c) => c.next).length}>
              {NEXT_PAYMENT}
            </th>
            <th scope="col" rowSpan={2} className="st-num">
              Kuukaudessa
            </th>
            {linked && <td rowSpan={2} />}
          </tr>
          <tr>
            {LOAN_COLUMNS.filter((c) => c.next).map((c) => (
              <th key={c.key} scope="col" className={c.figure ? "st-num" : undefined}>
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="housing-name" title={row.name}>
                <a href={row.saved ? `#/reports#${reportAnchor}` : paymentsOf(row.name)}>{row.name}</a>
                {row.lender && <span className="st-sub">{row.lender}</span>}
                {row.part && <span className="st-sub">{row.part}</span>}
              </th>
              {LOAN_COLUMNS.map((c) => (
                <Fragment key={c.key}>
                  {c.key === "due" && <td className="housing-group">{NEXT_PAYMENT}</td>}
                  <td className={`housing-${c.key}${c.figure ? " st-num" : ""}`}>
                    <span className="housing-label">{c.head}</span>
                    <span>{row.cells[c.key]}</span>
                  </td>
                </Fragment>
              ))}
              {linked && <td className="housing-link">{row.link && <a href={SETTINGS_LOANS}>{row.link}</a>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Charges({ rows, addsUp }: { rows: View["charges"]; addsUp: boolean }) {
  return (
    <>
      <h3 className="st-cap" id="housing-charges-h">
        Asumiskulut
      </h3>
      <table className="st-table housing-charges" aria-labelledby="housing-charges-h">
        <thead>
          <tr>
            <th scope="col">Kulu</th>
            <th scope="col">Saaja</th>
            <th scope="col" className="st-num">
              Kuukaudessa
            </th>
          </tr>
        </thead>
        <tbody className={addsUp ? "adds-up" : undefined}>
          {rows.map((row, i) => (
            <tr key={row.key} className={addsUp ? (i === 0 ? "part-first" : i === rows.length - 1 ? "part-last" : undefined) : undefined}>
              <td>
                {row.kind}
                {row.part && <span className="st-sub">{row.part}</span>}
              </td>
              <td className="st-cut" title={row.payee}>
                <a href={paymentsOf(row.payee)}>{row.payee}</a>
              </td>
              <td className={`st-num sum${row.share ? " share" : ""}`} style={row.share ? ({ "--from": row.share.from, "--part": row.share.part } as CSSProperties) : undefined}>
                {money(row.cents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Sums({ view }: { view: View }) {
  return (
    <>
      <dl className={`st-rows housing-sums${view.sumsAddUp ? " adds-up" : ""}`}>
        {view.sums.map((sum, i) => (
          <div key={sum.label} className={sum.total ? "st-row st-total" : `st-row${view.sumsAddUp ? (i === 0 ? " part-first" : " part-last") : ""}`}>
            <dt className="st-name">{sum.label}</dt>
            <dd className="st-num">{sum.cents === null ? DASH : money(sum.cents)}</dd>
          </div>
        ))}
      </dl>
      {view.missing && <p className="st-note">{view.missing}</p>}
    </>
  );
}

/**
 * `housing` is the running month's answer and is null when there is nothing to show; `reportAnchor` is the section of
 * Raportit that tells a loan's payments, which the page that mounts the block names. `onAnswered` reads the page's answer
 * again once the question is answered.
 */
export function Housing({ housing, reportAnchor, onAnswered }: { housing: NonNullable<DashboardData["housing"]>; reportAnchor: string; onAnswered: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // the question is gone at once; the reload only confirms it
  const [answered, setAnswered] = useState(false);
  const view = housingView(housing);
  const ask = view.ask && !answered;
  if (view.sums.length === 0 && !ask) return null;

  const answer = () => {
    setBusy(true);
    setFailed(false);
    api("/api/marks", { method: "PUT", body: { subject: MORTGAGE_QUESTION, mark: "dismissed" } })
      .then(() => {
        setAnswered(true);
        onAnswered();
      })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return (
    <section className="card st-block housing" aria-labelledby="housing-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="housing-h">Asuminen</h2>
        </div>
      </div>
      {ask && (
        <div className="st-part housing-ask">
          <span className="st-name">Asuntolaina</span>
          <span className="housing-answers">
            <a className="btn btn-small" href={SETTINGS_LOANS}>
              Lisää asuntolaina
            </a>
            <button type="button" className="btn btn-small" disabled={busy} aria-busy={busy || undefined} onClick={answer}>
              Ei asuntolainaa
            </button>
          </span>
          {failed && (
            <span className="st-sub" role="alert">
              Tallennus ei onnistunut.
            </span>
          )}
        </div>
      )}
      {view.loans.length > 0 && <Loans rows={view.loans} reportAnchor={reportAnchor} />}
      {view.charges.length > 0 ? (
        <div className="st-cols st-cols-3">
          <div className="st-wide">
            <Charges rows={view.charges} addsUp={view.chargesAddUp} />
          </div>
          <div className="housing-total">
            <Sums view={view} />
          </div>
        </div>
      ) : (
        view.sums.length > 0 && (
          <div className="st-part">
            <Sums view={view} />
          </div>
        )
      )}
    </section>
  );
}
