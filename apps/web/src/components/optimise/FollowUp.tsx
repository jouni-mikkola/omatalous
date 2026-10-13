/**
 * Seuranta: what came of a done decision (its verdict, the monthly effect and why), the switches the data shows waiting
 * for a confirmation, and, from four months of snapshots, the euros a year found against the euros confirmed.
 */
import { type AreaView, type FindingOutcome, type FollowUp as FollowUpData, parseFindingId, type SwitchProposal, type Verdict } from "@banking/core";
import { useState } from "react";
import { api, query } from "../../api.ts";
import { LineChart } from "../../charts/LineChart.tsx";
import { date, money, monthLabel, monthLong } from "../../format.ts";
import type { Scope } from "../../types.ts";
import { Section } from "../Section.tsx";
import { type Changed, nameOf, subjectName } from "./shared.tsx";

const VERDICT: Record<Verdict, { text: string; badge: string }> = {
  vahvistui: { text: "Vahvistui", badge: "good" },
  todennäköinen: { text: "Todennäköinen", badge: "" },
  epäselvä: { text: "Epäselvä", badge: "" },
  huonompi: { text: "Huonompi", badge: "warn" },
  odottaa: { text: "Odottaa", badge: "" },
};

/** One done decision's outcome, under its row in Päätetyt. Core's reason starts with the monthly effect, so it is said once. */
export function Outcome({ outcome }: { outcome: FindingOutcome }) {
  const v = VERDICT[outcome.verdict];
  return (
    <p className="outcome small">
      <span className={`badge ${v.badge}`}>Seuranta: {v.text}</span>
      <span className="muted">{outcome.reason}</span>
      {outcome.replacement && <span className="muted">{outcome.replacement.text}</span>}
    </p>
  );
}

/** What the confirmation names: the merchant of the finding's series, else its area ("vinkki Helen", "vinkki Sähkö"). */
function shortName(id: string, areas: readonly AreaView[]): string {
  const parts = parseFindingId(id);
  if (!parts) return id;
  const merchant = parts.subject ? subjectName(parts.subject) : null;
  return merchant && merchant !== parts.subject ? merchant : (areas.find((a) => a.id === parts.area)?.label ?? parts.area);
}

/** A switch the data shows: the household confirms it, nothing is stored before that. */
function Proposal({ proposal, name, short, scope, onChanged }: { proposal: SwitchProposal; name: string; short: string; scope: Scope; onChanged: Changed }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = () => {
    setBusy(true);
    setError(null);
    api(`/api/optimise/findings/${encodeURIComponent(proposal.findingId)}${query({ scope })}`, { method: "PUT", body: { status: "done", effectiveDate: proposal.date } })
      .then(() => onChanged("Vinkki siirrettiin kohtaan Päätetyt."))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <li className="decided">
      <div className="decided-text">
        <span className="decided-title">{name}</span>
        <span className="small muted">{proposal.text}</span>
      </div>
      {asking ? (
        <div className="decide-form" role="group" aria-label={`Vahvista: ${name}`}>
          <span>
            Merkitäänkö vinkki {short} tehdyksi {date(proposal.date)} alkaen?
          </span>
          <button className="btn btn-small btn-primary" type="button" disabled={busy} aria-busy={busy || undefined} onClick={confirm}>
            Merkitse tehdyksi
          </button>
          <button className="btn btn-small" type="button" onClick={() => setAsking(false)}>
            Peruuta
          </button>
        </div>
      ) : (
        <button className="btn btn-small" type="button" aria-label={`Vahvista: ${name}`} onClick={() => setAsking(true)}>
          Vahvista
        </button>
      )}
      {error && (
        <span className="field-error error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}

const FOUND = "Löydetty vuodessa";
const CONFIRMED = "Vahvistettu vuodessa";

/** Found against confirmed euros a year, one axis, with a table view. */
function Line({ line }: { line: FollowUpData["line"] }) {
  const [table, setTable] = useState(false);
  return (
    <div className="evidence-part">
      <div className="evidence-head">
        <h3>Löydetty ja vahvistettu</h3>
        <button className="btn btn-small" type="button" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {table ? "Kaavio" : "Taulukko"}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>Kuukausi</th>
                <th className="num">{FOUND}</th>
                <th className="num">{CONFIRMED}</th>
              </tr>
            </thead>
            <tbody>
              {line.map((p) => (
                <tr key={p.month}>
                  <td>{monthLong(p.month)}</td>
                  <td className="num">{money(p.foundCents, false)}</td>
                  <td className="num">{money(p.confirmedCents, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <LineChart
          labels={line.map((p, i) => monthLabel(p.month, i === 0 || p.month.endsWith("-01")))}
          series={[
            { key: "found", label: FOUND, color: "var(--series-1)", values: line.map((p) => p.foundCents) },
            { key: "confirmed", label: CONFIRMED, color: "var(--series-2)", values: line.map((p) => p.confirmedCents) },
          ]}
          height={200}
        />
      )}
    </div>
  );
}

/** Seuranta: shown when the data shows a switch to confirm or the line has four months. */
export function FollowUp({ followUp, areas, titles, scope, onChanged }: { followUp: FollowUpData; areas: readonly AreaView[]; titles: ReadonlyMap<string, string>; scope: Scope; onChanged: Changed }) {
  const { proposals, line } = followUp;
  // under four months a line is a few points and tells nothing; a section left with its heading alone is not drawn
  const drawn = line.length >= 4;
  if (!proposals.length && !drawn) return null;
  return (
    <Section id="seuranta" title="Seuranta">
      {proposals.length > 0 && (
        <ul className="decided-list">
          {proposals.map((p) => (
            <Proposal key={p.findingId} proposal={p} name={titles.get(p.findingId) ?? nameOf(p.findingId, areas)} short={shortName(p.findingId, areas)} scope={scope} onChanged={onChanged} />
          ))}
        </ul>
      )}
      {drawn && <Line line={line} />}
    </Section>
  );
}
