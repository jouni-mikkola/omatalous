/**
 * Päätetyt: every finding and insight the household has answered, newest first, each with its state (Tehty, Ei koske
 * meitä or Muistutus) and a way to take the answer back.
 */
import type { DismissedInsight, Finding, FindingOutcome, FindingState, OptimiseData } from "@banking/core";
import { useState } from "react";
import { api, query } from "../../api.ts";
import { date, money } from "../../format.ts";
import type { Scope } from "../../types.ts";
import { Outcome } from "./FollowUp.tsx";
import { insightFigure } from "./Others.tsx";
import { Section } from "../Section.tsx";
import { type Changed, nameOf, REASON_TEXT } from "./shared.tsx";

/** "Peruuta": the answer is taken back and the finding or insight returns to its place. */
function Undo({ title, take, onChanged }: { title: string; take: () => Promise<unknown>; onChanged: Changed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = () => {
    setBusy(true);
    setError(null);
    take()
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

interface Entry {
  key: string;
  title: string;
  /** The state first, then its date or reason and the estimate, said apart with a dot. */
  note: string;
  /** ISO timestamp of the answer: the list is newest first. */
  at: string;
  outcome?: FindingOutcome | undefined;
  take: () => Promise<unknown>;
}

/** The parts of a note that have something to say, said apart with a dot. */
const note = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ");

const estimate = (state: FindingState, finding: Finding | null) => {
  const mid = state.midCents ?? finding?.euros?.midCents ?? null;
  return mid === null ? null : `arvio ${money(mid, false)} vuodessa`;
};

function entriesOf(data: OptimiseData, states: readonly FindingState[], outcomes: ReadonlyMap<string, FindingOutcome>, scope: Scope): Entry[] {
  const takeState = (id: string) => () => api(`/api/optimise/findings/${encodeURIComponent(id)}${query({ scope })}`, { method: "PUT", body: { status: null } });
  const takeMark = (d: DismissedInsight) => () => api("/api/marks", { method: "PUT", body: { subject: d.subject, mark: null } });
  // a snoozed finding is hidden from the page, so its reminder is listed here, where it can be taken back
  const snoozed = states.filter((s) => s.status === "snoozed" && s.until !== null && s.until > data.today);
  return [
    ...data.done.map(({ state, finding }) => ({
      key: state.findingId,
      title: finding?.title ?? nameOf(state.findingId, data.areas),
      note: note(`Tehty ${date(state.effectiveDate ?? state.decidedAt)}`, finding ? null : "ei enää näy tiedoissa", estimate(state, finding)),
      at: state.decidedAt,
      outcome: outcomes.get(state.findingId),
      take: takeState(state.findingId),
    })),
    ...snoozed.map((state) => ({
      key: state.findingId,
      title: nameOf(state.findingId, data.areas),
      note: note(`Muistutus ${date(state.until)}`, estimate(state, null)),
      at: state.decidedAt,
      take: takeState(state.findingId),
    })),
    ...data.dismissed.map(({ state, finding }) => ({
      key: state.findingId,
      title: finding.title,
      note: note("Ei koske meitä", state.reason ? REASON_TEXT[state.reason] : "ei syytä annettu", estimate(state, finding)),
      at: state.decidedAt,
      take: takeState(state.findingId),
    })),
    ...data.othersDismissed.map((d) => ({
      key: d.subject,
      title: d.insight.title,
      note: note("Ei koske meitä", `${insightFigure(d.insight)} vuodessa`, "palaa, jos summa muuttuu 25 % tai enemmän"),
      at: d.markedAt,
      take: takeMark(d),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at) || a.title.localeCompare(b.title));
}

export function Decided({ data, states, outcomes, scope, onChanged }: { data: OptimiseData; states: readonly FindingState[]; outcomes: ReadonlyMap<string, FindingOutcome>; scope: Scope; onChanged: Changed }) {
  const entries = entriesOf(data, states, outcomes, scope);
  if (!entries.length) return null;
  return (
    <Section id="paatetyt" title="Päätetyt">
      <ul className="decided-list">
        {entries.map((e) => (
          <li key={e.key} className="decided">
            <div className="decided-text">
              <span className="decided-title">{e.title}</span>
              <span className="small muted">{e.note}</span>
              {e.outcome && <Outcome outcome={e.outcome} />}
            </div>
            <Undo title={e.title} take={e.take} onChanged={onChanged} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
