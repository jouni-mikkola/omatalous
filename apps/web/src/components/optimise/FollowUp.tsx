/**
 * Seuranta: what came of the done decisions (the table the page passes in), the switches the data shows waiting for a
 * confirmation, and, from four months of snapshots, the euros a year found against the euros confirmed.
 */
import { type AreaView, type FollowUp as FollowUpData, parseFindingId, type SwitchProposal } from "@banking/core";
import { type ReactNode, useState } from "react";
import { Table } from "../table/Table.tsx";
import { ChartWithTable } from "../table/selection.tsx";
import { api, query } from "../../api.ts";
import { LineChart } from "../../charts/LineChart.tsx";
import { date, monthLabel, monthLong } from "../../format.ts";
import { t } from "../../text.ts";
import type { Scope } from "../../types.ts";
import { Section } from "../Section.tsx";
import { type Changed, nameOf, subjectName } from "./shared.tsx";
import { Button } from "../ui/Button.tsx";
import { color } from "../../design/tokens.ts";
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
      .then(() => onChanged(t("ow.fa_moved")))
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
        <div className="decide-form" role="group" aria-label={t("ow.fu_confirm_aria", { name })}>
          <span>
            {t("ow.fu_ask", { short, date: date(proposal.date) })}
          </span>
          <Button variant="primary" busy={busy} onClick={confirm}>
            {t("ow.fu_mark")}
          </Button>
          <Button onClick={() => setAsking(false)}>
            {t("ow.cancel")}
          </Button>
        </div>
      ) : (
        <Button aria-label={t("ow.fu_confirm_aria", { name })} onClick={() => setAsking(true)}>
          {t("ow.fu_confirm")}
        </Button>
      )}
      {error && (
        <span className="field-error error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}

const FOUND = "ow.fu_found";
const CONFIRMED = "ow.fu_confirmed";

/** Found against confirmed euros a year, one axis, with the months as a table under it. */
function Line({ line }: { line: FollowUpData["line"] }) {
  return (
    <div className="evidence-part">
      <div className="evidence-head">
        <h3>{t("ow.fu_line")}</h3>
      </div>
      <ChartWithTable
        chart={
          <LineChart
            labels={line.map((p, i) => monthLabel(p.month, i === 0 || p.month.endsWith("-01")))}
            keys={line.map((p) => p.month)}
            series={[
              { key: "found", label: t(FOUND), color: color["series-1"], values: line.map((p) => p.foundCents) },
              { key: "confirmed", label: t(CONFIRMED), color: color["series-2"], values: line.map((p) => p.confirmedCents) },
            ]}
            height={200}
          />
        }
        table={
          <Table
            caption={t("ow.fu_table")}
            rows={line}
            rowKey={(p) => p.month}
            columns={[
              { key: "month", label: t("ow.ms_month"), kind: "text", rowHead: true, cell: (p) => monthLong(p.month) },
              { key: "found", label: t(FOUND), kind: "money", main: true, cents: (p) => p.foundCents },
              { key: "confirmed", label: t(CONFIRMED), kind: "money", cents: (p) => p.confirmedCents },
            ]}
          />
        }
      />
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
    <Section id="seuranta" title={head?.title ?? t("ow.fu_title")} sub={head?.sub} datum={head?.datum}>
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
