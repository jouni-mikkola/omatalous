/** What a household can do with a finding: open its calculation, mark it done, set it aside, put it off, add what makes it exact. */
import { addDays, DISMISS_REASONS, type Finding, type IsoDate } from "@banking/core";
import { type FormEvent, useState } from "react";
import { api, query } from "../../api.ts";
import { date } from "../../format.ts";
import type { Scope } from "../../types.ts";
import { InputForm } from "./Inputs.tsx";
import { type Changed, REASON_TEXT } from "./shared.tsx";

type Panel = "done" | "dismiss" | "snooze" | "refine";

/** A decision stays valid for a year in both directions (the server's limit). */
const YEAR = 365;
/** Days before a deadline that "Kaksi viikkoa ennen määräaikaa" reminds. */
const BEFORE_DEADLINE = 14;

/** The days "Muistuta myöhemmin" offers; the deadline one only while it is still ahead. */
function snoozeChoices(finding: Finding, today: IsoDate): { label: string; until: IsoDate }[] {
  const choices = [
    { label: "30 päivää", until: addDays(today, 30) },
    { label: "90 päivää", until: addDays(today, 90) },
    { label: "Vuoden päästä", until: addDays(today, YEAR) },
  ];
  const warn = finding.decideBy ? addDays(finding.decideBy, -BEFORE_DEADLINE) : null;
  if (warn && warn > today && warn <= addDays(today, YEAR)) choices.push({ label: "Kaksi viikkoa ennen määräaikaa", until: warn });
  return choices;
}

export function FindingActions({ finding, describedBy, today, scope, open, onToggleOpen, onChanged }: {
  finding: Finding;
  /** The id of the element with the finding's title: the buttons are described by it. */
  describedBy: string;
  today: IsoDate;
  scope: Scope;
  open: boolean;
  onToggleOpen: () => void;
  onChanged: Changed;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [day, setDay] = useState<string>(today);
  const [busy, setBusy] = useState(false);
  const [doing, setDoing] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: Panel) => {
    setError(null);
    setPanel((p) => (p === next ? null : next));
  };
  const send = (body: Record<string, unknown>, said: string, key = "") => {
    setBusy(true);
    setDoing(key);
    setError(null);
    api(`/api/optimise/findings/${encodeURIComponent(finding.id)}${query({ scope })}`, { method: "PUT", body })
      .then(() => onChanged(said))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const done = (e: FormEvent) => {
    e.preventDefault();
    send({ status: "done", effectiveDate: day }, "Vinkki siirrettiin kohtaan Päätetyt.");
  };
  const button = (label: string, on: Panel) => (
    <button className="btn btn-small" type="button" aria-expanded={panel === on} aria-describedby={describedBy} onClick={() => toggle(on)}>
      {label}
    </button>
  );
  const cancel = (
    <button className="btn btn-small" type="button" onClick={() => setPanel(null)}>
      Peruuta
    </button>
  );

  return (
    <div className="finding-actions">
      <div className="form-row">
        <button className="btn btn-small" type="button" aria-expanded={open} aria-describedby={describedBy} onClick={onToggleOpen}>
          {open ? "Sulje laskelma" : "Avaa laskelma"}
        </button>
        {button("Tein tämän", "done")}
        {button("Ei koske meitä", "dismiss")}
        {button("Muistuta myöhemmin", "snooze")}
        {finding.needs?.length ? button("Tarkenna", "refine") : null}
      </div>
      {panel === "done" && (
        <form className="decide-form" onSubmit={done}>
          <label>
            Muutoksen päivä
            <input type="date" value={day} min={addDays(today, -YEAR)} max={addDays(today, YEAR)} required onChange={(e) => setDay(e.target.value)} />
          </label>
          <button className="btn btn-small btn-primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
            Tallenna
          </button>
          {cancel}
        </form>
      )}
      {panel === "dismiss" && (
        <div className="decide-form" role="group" aria-label="Syy">
          {DISMISS_REASONS.map((reason) => (
            <button key={reason} className="btn btn-small" type="button" disabled={busy} aria-busy={(busy && doing === reason) || undefined} onClick={() => send({ status: "dismissed", reason }, "Vinkki siirrettiin kohtaan Päätetyt.", reason)}>
              {REASON_TEXT[reason]}
            </button>
          ))}
          {cancel}
        </div>
      )}
      {panel === "snooze" && (
        <div className="decide-form" role="group" aria-label="Muistutus">
          {snoozeChoices(finding, today).map((c) => (
            <button key={c.label} className="btn btn-small" type="button" disabled={busy} aria-busy={(busy && doing === c.label) || undefined} onClick={() => send({ status: "snoozed", until: c.until }, `Vinkki palaa ${date(c.until)}.`, c.label)}>
              {c.label}
            </button>
          ))}
          {cancel}
        </div>
      )}
      {panel === "refine" && (
        <div className="decide-form refine">
          {finding.needs?.map((key) => (
            <InputForm key={key} inputKey={key} today={today} scope={scope} onSaved={onChanged} />
          ))}
          {cancel}
        </div>
      )}
      {error && (
        <div className="field-error error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
