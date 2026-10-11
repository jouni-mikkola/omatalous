/** Jo hoidossa and Ei koske meitä: the findings the household has decided on, each with a way to take the decision back. */
import { type AreaView, type Finding, type FindingOutcome, type FindingState, type OptimiseData, parseFindingId } from "@banking/core";
import { useState } from "react";
import { api, query } from "../../api.ts";
import { date, money } from "../../format.ts";
import type { Scope } from "../../types.ts";
import { Outcome } from "./FollowUp.tsx";
import { type Changed, REASON_TEXT, SectionCard, subjectName } from "./shared.tsx";

/**
 * The words for a decision whose finding is not on the page (done and gone from the data, or snoozed): its area, and the
 * merchant when the id holds a series. Any other subject is a code ("video"), not words, so it is left out.
 */
export function nameOf(id: string, areas: readonly AreaView[]): string {
  const parts = parseFindingId(id);
  if (!parts) return id;
  const area = areas.find((a) => a.id === parts.area)?.label ?? parts.area;
  const merchant = parts.subject ? subjectName(parts.subject) : null;
  return merchant && merchant !== parts.subject ? `${area}: ${merchant}` : area;
}

/** "Peruuta": the decision is taken back and the finding returns to its area. */
function Undo({ id, title, scope, onChanged }: { id: string; title: string; scope: Scope; onChanged: Changed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = () => {
    setBusy(true);
    setError(null);
    api(`/api/optimise/findings/${encodeURIComponent(id)}${query({ scope })}`, { method: "PUT", body: { status: null } })
      .then(() => onChanged("Päätös peruttiin."))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="decided-undo">
      <button className="btn btn-small" type="button" aria-label={`Peruuta päätös: ${title}`} disabled={busy} onClick={undo}>
        Peruuta
      </button>
      {error && (
        <span className="field-error error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function Row({ state, finding, title, note, outcome, scope, onChanged }: { state: FindingState; finding: Finding | null; title: string; note: string; outcome?: FindingOutcome | undefined; scope: Scope; onChanged: Changed }) {
  const mid = state.midCents ?? finding?.euros?.midCents ?? null;
  return (
    <li className="decided">
      <div className="decided-text">
        <span className="decided-title">{title}</span>
        <span className="small muted">
          {note}
          {mid !== null && `, arvio ${money(mid, false)} vuodessa`}
        </span>
        {outcome && <Outcome outcome={outcome} />}
      </div>
      <Undo id={state.findingId} title={title} scope={scope} onChanged={onChanged} />
    </li>
  );
}

export function Decided({ data, states, outcomes, scope, onChanged }: { data: OptimiseData; states: readonly FindingState[]; outcomes: ReadonlyMap<string, FindingOutcome>; scope: Scope; onChanged: Changed }) {
  // a snoozed finding is hidden from the page, so its reminder is listed here, where it can be taken back
  const snoozed = states.filter((s) => s.status === "snoozed" && s.until !== null && s.until > data.today);
  return (
    <>
      {data.done.length > 0 && (
        <SectionCard id="hoidossa" title="Jo hoidossa" sub="Päätökset, jotka olet merkinnyt tehdyiksi">
          <ul className="decided-list">
            {data.done.map(({ state, finding }) => (
              <Row
                key={state.findingId}
                state={state}
                finding={finding}
                title={finding?.title ?? nameOf(state.findingId, data.areas)}
                note={`Tehty ${date(state.effectiveDate ?? state.decidedAt)}${finding ? "" : ", asia ei enää näy tiedoissa"}`}
                outcome={outcomes.get(state.findingId)}
                scope={scope}
                onChanged={onChanged}
              />
            ))}
          </ul>
        </SectionCard>
      )}
      {snoozed.length > 0 && (
        <SectionCard id="muistutukset" title="Muistutukset" sub="Nämä palaavat sivulle myöhemmin">
          <ul className="decided-list">
            {snoozed.map((state) => (
              <Row key={state.findingId} state={state} finding={null} title={nameOf(state.findingId, data.areas)} note={`Palaa ${date(state.until)}`} scope={scope} onChanged={onChanged} />
            ))}
          </ul>
        </SectionCard>
      )}
      {data.dismissed.length > 0 && (
        <SectionCard id="ei-koske" title="Ei koske meitä" sub="Nämä on jätetty pois, kunnes perut päätöksen">
          <ul className="decided-list">
            {data.dismissed.map(({ state, finding }) => (
              <Row
                key={state.findingId}
                state={state}
                finding={finding}
                title={finding.title}
                note={state.reason ? REASON_TEXT[state.reason] : "Ei syytä annettu"}
                scope={scope}
                onChanged={onChanged}
              />
            ))}
          </ul>
        </SectionCard>
      )}
    </>
  );
}
