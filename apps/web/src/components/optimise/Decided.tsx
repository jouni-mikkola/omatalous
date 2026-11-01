/**
 * Päätetyt: every finding and insight the household has answered, newest first, each with its state (Tehty, Ei koske
 * meitä or Muistutus) and a way to take the answer back.
 */
import { type DismissedInsight, type Finding, type FindingState, insightText, type OptimiseData } from "@banking/core";
import { useState } from "react";
import { api, query } from "../../api.ts";
import { date, language, money } from "../../format.ts";
import { t } from "../../text.ts";
import type { Scope } from "../../types.ts";
import { insightFigure } from "./Others.tsx";
import { Section } from "../Section.tsx";
import { type Changed, nameOf, reasonText } from "./shared.tsx";
import { Button } from "../ui/Button.tsx";
/** "Peruuta": the answer is taken back and the finding or insight returns to its place. */
function Undo({ title, take, onChanged }: { title: string; take: () => Promise<unknown>; onChanged: Changed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = () => {
    setBusy(true);
    setError(null);
    take()
      .then(() => onChanged(t("ow.dec_undone")))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="decided-undo">
      <Button aria-label={t("ow.dec_undo_aria", { title })} busy={busy} onClick={undo}>
        {t("ow.dec_undo")}
      </Button>
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
  take: () => Promise<unknown>;
}

/** The parts of a note that have something to say, said apart with a dot. */
const note = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ");

const estimate = (state: FindingState, finding: Finding | null) => {
  const mid = state.midCents ?? finding?.euros?.midCents ?? null;
  return mid === null ? null : t("ow.dec_estimate", { amount: money(mid, false) });
};

function entriesOf(data: OptimiseData, scope: Scope): Entry[] {
  const takeState = (id: string) => () => api(`/api/optimise/findings/${encodeURIComponent(id)}${query({ scope })}`, { method: "PUT", body: { status: null } });
  const takeMark = (d: DismissedInsight) => () => api("/api/marks", { method: "PUT", body: { subject: d.subject, mark: null } });
  return [
    ...data.done.map(({ state, finding }) => ({
      key: state.findingId,
      title: finding?.title ?? nameOf(state.findingId, data.areas),
      note: note(t("ow.dec_done", { date: date(state.effectiveDate ?? state.decidedAt) }), finding ? null : t("ow.dec_gone"), estimate(state, finding)),
      at: state.decidedAt,
      take: takeState(state.findingId),
    })),
    // a snoozed finding is hidden from the page, so its reminder is listed here, with its words, where it can be taken back
    ...data.snoozed.map(({ state, finding }) => ({
      key: state.findingId,
      title: finding?.title ?? nameOf(state.findingId, data.areas),
      note: note(t("ow.dec_remind", { date: date(state.until) }), finding ? null : t("ow.dec_gone_now"), estimate(state, finding)),
      at: state.decidedAt,
      take: takeState(state.findingId),
    })),
    ...data.dismissed.map(({ state, finding }) => ({
      key: state.findingId,
      title: finding.title,
      note: note(t("ow.dec_notmine"), state.reason ? reasonText(state.reason) : t("ow.dec_noreason"), estimate(state, finding)),
      at: state.decidedAt,
      take: takeState(state.findingId),
    })),
    ...data.othersDismissed.map((d) => ({
      key: d.subject,
      title: insightText(d.insight, language()).title,
      note: note(t("ow.dec_notmine"), insightFigure(d.insight), t("ow.dec_returns")),
      at: d.markedAt,
      take: takeMark(d),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at) || a.title.localeCompare(b.title));
}

/** `states` is no longer read: a reminder comes with its finding in `data.snoozed`. The verdict of a done one is Seuranta's. */
export function Decided({ data, scope, onChanged }: { data: OptimiseData; states?: readonly FindingState[]; scope: Scope; onChanged: Changed }) {
  const entries = entriesOf(data, scope);
  if (!entries.length) return null;
  return (
    <Section id="paatetyt" title={t("ow.dec_title")}>
      <ul className="decided-list">
        {entries.map((e) => (
          <li key={e.key} className="decided">
            <div className="decided-text">
              <span className="decided-title">{e.title}</span>
              <span className="small muted">{e.note}</span>
            </div>
            <Undo title={e.title} take={e.take} onChanged={onChanged} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
