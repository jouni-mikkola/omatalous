/**
 * What a household can do with a finding, behind one key (Päätä): mark it done, set it aside, put it off, add what makes
 * it exact. Its figure opens the calculation.
 */
import { addDays, DISMISS_REASONS, type Finding, type IsoDate } from "@banking/core";
import { type FormEvent, useState } from "react";
import { api, query } from "../../api.ts";
import { date } from "../../format.ts";
import { t } from "../../text.ts";
import type { Scope } from "../../types.ts";
import { InputForm } from "./Inputs.tsx";
import { type Changed, reasonText } from "./shared.tsx";
import { Button } from "../ui/Button.tsx";
type Panel = "done" | "dismiss" | "snooze" | "refine";

/** A decision stays valid for a year in both directions (the server's limit). */
const YEAR = 365;
/** Days before a deadline that "Kaksi viikkoa ennen määräaikaa" reminds. */
const BEFORE_DEADLINE = 14;

/** The days "Muistuta myöhemmin" offers; the deadline one only while it is still ahead. */
function snoozeChoices(finding: Finding, today: IsoDate): { label: string; until: IsoDate }[] {
  const choices = [
    { label: t("ow.sn_30"), until: addDays(today, 30) },
    { label: t("ow.sn_90"), until: addDays(today, 90) },
    { label: t("ow.sn_year"), until: addDays(today, YEAR) },
  ];
  const warn = finding.decideBy ? addDays(finding.decideBy, -BEFORE_DEADLINE) : null;
  if (warn && warn > today && warn <= addDays(today, YEAR)) choices.push({ label: t("ow.sn_deadline"), until: warn });
  return choices;
}

export function FindingActions({ finding, describedBy, today, scope, onChanged }: {
  finding: Finding;
  /** The id of the element with the finding's title: the buttons are described by it. */
  describedBy: string;
  today: IsoDate;
  scope: Scope;
  onChanged: Changed;
}) {
  // one key at rest; the four answers show when it is pressed
  const [choosing, setChoosing] = useState(false);
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
    send({ status: "done", effectiveDate: day }, t("ow.fa_moved"));
  };
  const button = (label: string, on: Panel) => (
    <Button aria-expanded={panel === on} aria-describedby={describedBy} onClick={() => toggle(on)}>
      {label}
    </Button>
  );
  const cancel = (
    <Button onClick={() => setPanel(null)}>
      {t("ow.cancel")}
    </Button>
  );

  return (
    <div className="finding-actions">
      <Button className="decide-key" aria-expanded={choosing} aria-describedby={describedBy} onClick={() => {
          setChoosing((c) => !c);
          setPanel(null);
        }}>
        {t("ow.fa_decide")}
      </Button>
      {choosing && (
        <div className="form-row decide-choices">
          {button(t("ow.fa_did"), "done")}
          {button(t("ow.fa_dismiss"), "dismiss")}
          {button(t("ow.fa_later"), "snooze")}
          {finding.needs?.length ? button(t("ow.fa_refine"), "refine") : null}
        </div>
      )}
      {panel === "done" && (
        <form className="decide-form" onSubmit={done}>
          <label>
            {t("ow.fa_day")}
            <input type="date" value={day} min={addDays(today, -YEAR)} max={addDays(today, YEAR)} required onChange={(e) => setDay(e.target.value)} />
          </label>
          <Button variant="primary" type="submit" busy={busy}>
            {t("ow.fa_save")}
          </Button>
          {cancel}
        </form>
      )}
      {panel === "dismiss" && (
        <div className="decide-form" role="group" aria-label={t("ow.fa_reason")}>
          {DISMISS_REASONS.map((reason) => (
            <Button key={reason}  disabled={busy} aria-busy={(busy && doing === reason) || undefined} onClick={() => send({ status: "dismissed", reason }, t("ow.fa_moved"), reason)}>
              {reasonText(reason)}
            </Button>
          ))}
          {cancel}
        </div>
      )}
      {panel === "snooze" && (
        <div className="decide-form" role="group" aria-label={t("ow.fa_reminder")}>
          {snoozeChoices(finding, today).map((c) => (
            <Button key={c.label}  disabled={busy} aria-busy={(busy && doing === c.label) || undefined} onClick={() => send({ status: "snoozed", until: c.until }, t("ow.fa_returns", { date: date(c.until) }), c.label)}>
              {c.label}
            </Button>
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
