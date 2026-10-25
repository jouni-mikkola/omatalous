/**
 * Seuranta: what came of the done decisions (the table the page passes in), the switches the data shows waiting for a
 * confirmation, and, from four months of snapshots, the euros a year found against the euros confirmed.
 */
import { type AreaView, type FollowUp as FollowUpData, parseFindingId, type SwitchProposal } from "@banking/core";
import { type ReactNode, useState } from "react";
import { Table } from "../table/Table.tsx";
import { TableToggle } from "../TableToggle.tsx";
import { api, query } from "../../api.ts";
import { LineChart } from "../../charts/LineChart.tsx";
import { date, monthLabel, monthLong } from "../../format.ts";
import type { Scope } from "../../types.ts";
import { Section } from "../Section.tsx";
import { type Changed, nameOf, subjectName } from "./shared.tsx";

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

const FOUND = "Arvioitu vuodessa";
const CONFIRMED = "Vahvistettu vuodessa";

/** Found against confirmed euros a year, one axis, with a table view. */
function Line({ line }: { line: FollowUpData["line"] }) {
  const [table, setTable] = useState(false);
  return (
    <div className="evidence-part">
      <div className="evidence-head">
        <h3>Arvioitu ja vahvistettu</h3>
        <TableToggle table={table} onChange={setTable} />
      </div>
      {table ? (
        <Table
          caption="Arvioitu ja vahvistettu kuukausittain"
          rows={line}
          rowKey={(p) => p.month}
          columns={[
            { key: "month", label: "Kuukausi", kind: "text", rowHead: true, cell: (p) => monthLong(p.month) },
            { key: "found", label: FOUND, kind: "money", main: true, cents: (p) => p.foundCents },
            { key: "confirmed", label: CONFIRMED, kind: "money", cents: (p) => p.confirmedCents },
          ]}
        />
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
export function FollowUp({ followUp, areas, titles, scope, onChanged, head, children }: { followUp: FollowUpData; areas: readonly AreaView[]; titles: ReadonlyMap<string, string>; scope: Scope; onChanged: Changed; head?: { title: string; sub?: string; datum?: ReactNode }; children?: ReactNode }) {
  const { proposals, line } = followUp;
  // under four months a line is a few points and tells nothing; a section left with its heading alone is not drawn
  const drawn = line.length >= 4;
  if (!proposals.length && !drawn && !children) return null;
  return (
    <Section id="seuranta" title={head?.title ?? "Seuranta"} sub={head?.sub} datum={head?.datum}>
      {children}
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
