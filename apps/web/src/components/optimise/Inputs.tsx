/** The numbers a household may type in: the values given and the form that stores one (Tarkistettavat asks for the missing ones). */
import { addMonthsToDate, type InputDef, inputDefOf, type InputRow, type InputValue, type IsoDate, choiceLabel, inputLabel, inputUnit, localeOf } from "@banking/core";
import { type FormEvent, useState } from "react";
import { api, query } from "../../api.ts";
import { date, eurosText, language, money, parseEuros, rateText } from "../../format.ts";
import { t } from "../../text.ts";
import type { Scope } from "../../types.ts";
import { Section } from "../Section.tsx";
import { type Changed, subjectName } from "./shared.tsx";
import { Button } from "../ui/Button.tsx";
const num = { format: (n: number) => new Intl.NumberFormat(localeOf(language()), { maximumFractionDigits: 2 }).format(n) };
/** A margin is stored in hundredths of a percent: 125 is 1,25 %. */
const percent = (bp: number) => `${num.format(bp / 100)}${language() === "en" ? "%" : " %"}`;

/** The label of an input, with the subscription it belongs to for a quote. */
function labelOf(def: InputDef, subject: string | null): string {
  const name = inputLabel(def, language());
  return subject ? `${name}: ${subjectName(subject)}` : name;
}

/** A stored value as a person reads it ("12 000 km vuodessa", "Kerrostalo"). */
export function valueText(def: InputDef, value: InputValue): string {
  switch (def.kind) {
    case "integer":
      return `${num.format(value as number)} ${inputUnit(def, language()) ?? ""}`.trim();
    case "cents":
      return t("opt.loan_a_year", { eur: money(value as number, false) });
    case "date":
      return date(value as string);
    case "choice":
      return def.choices!.some((c) => c.id === value) ? choiceLabel(def, String(value), language()) : String(value);
    case "loan_rate": {
      const rate = value as { marginBp: number; reference: string };
      return t("ow.in_and", { margin: percent(rate.marginBp), reference: def.choices!.some((c) => c.id === rate.reference) ? choiceLabel(def, rate.reference, language()) : rate.reference });
    }
  }
}

/** The value in the form the field starts with when the household changes it. */
function startText(def: InputDef, value: InputValue | undefined): { text: string; reference: string } {
  const reference = def.choices?.[0]?.id ?? "";
  if (value === undefined) return { text: "", reference };
  switch (def.kind) {
    case "integer":
      return { text: String(value), reference };
    case "cents": {
      const cents = value as number;
      return { text: cents % 100 === 0 ? String(cents / 100) : eurosText(cents), reference };
    }
    case "loan_rate": {
      const rate = value as { marginBp: number; reference: string };
      return { text: rateText(rate.marginBp), reference: rate.reference };
    }
    default:
      return { text: String(value), reference };
  }
}

/**
 * One field that stores one input. It sends what was typed and shows the server's Finnish answer when the value is out
 * of range, so the limits live in one place.
 */
export function InputForm({ inputKey, current, today, scope, onSaved, onCancel, quiet, answer, waiting }: {
  inputKey: string;
  current?: InputValue;
  today: IsoDate;
  scope: Scope;
  onSaved?: Changed;
  onCancel?: () => void;
  /** The label is already shown beside the form: screen readers still get it. */
  quiet?: boolean;
  /** Tarkistettavat sends the save itself, so the queue moves on and shows the server's error in its place. */
  answer?: (send: () => Promise<unknown>) => void;
  /** The queue's own wait, while `answer` sends. */
  waiting?: boolean;
}) {
  const found = inputDefOf(inputKey);
  const start = found ? startText(found.def, current) : { text: "", reference: "" };
  const [text, setText] = useState(start.text);
  const [reference, setReference] = useState(start.reference);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!found) return null;
  const { def, subject } = found;
  const label = labelOf(def, subject);

  const valueToSend = (): unknown => {
    switch (def.kind) {
      case "integer": {
        const n = Number(text.replace(/[\s ]/g, ""));
        return text.trim() && Number.isFinite(n) ? n : null;
      }
      case "cents":
        return parseEuros(text);
      case "loan_rate":
        return { marginBp: parseEuros(text), reference };
      default:
        return text || null;
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Enter in an empty field sends nothing, as the disabled button does
    if (!text.trim()) return;
    const send = () => api(`/api/optimise/inputs/${encodeURIComponent(inputKey)}${query({ scope })}`, { method: "PUT", body: { value: valueToSend() } });
    if (answer) return answer(send);
    setBusy(true);
    setError(null);
    send()
      .then(() => onSaved?.(t("ow.in_saved")))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const field = (() => {
    switch (def.kind) {
      case "date":
        return <input type="date" value={text} min={addMonthsToDate(today, def.minMonths!)} max={addMonthsToDate(today, def.maxMonths!)} onChange={(e) => setText(e.target.value)} />;
      case "choice":
        return (
          <select value={text} onChange={(e) => setText(e.target.value)}>
            <option value="">{t("ow.in_choose")}</option>
            {def.choices!.map((c) => (
              <option key={c.id} value={c.id}>
                {choiceLabel(def, c.id, language())}
              </option>
            ))}
          </select>
        );
      case "loan_rate":
        return (
          <>
            <input type="text" inputMode="decimal" size={6} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("ow.in_margin_aria")} aria-invalid={error ? true : undefined} />
            <span className="muted">%</span>
            <select value={reference} onChange={(e) => setReference(e.target.value)} aria-label={t("ow.in_ref_aria")}>
              {def.choices!.map((c) => (
                <option key={c.id} value={c.id}>
                  {choiceLabel(def, c.id, language())}
                </option>
              ))}
            </select>
          </>
        );
      default:
        return (
          <>
            <input type="text" inputMode={def.kind === "cents" ? "decimal" : "numeric"} size={9} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={error ? true : undefined} />
            {def.unit && <span className="muted">{inputUnit(def, language())}</span>}
          </>
        );
    }
  })();

  const line = <div className="input-line">{field}</div>;
  return (
    <form className="input-form" onSubmit={submit}>
      {def.kind === "loan_rate" ? (
        <div className="input-fields" role="group" aria-label={label}>
          <span className={quiet ? "sr-only" : undefined}>{label}</span>
          {line}
        </div>
      ) : (
        <label className="input-fields">
          <span className={quiet ? "sr-only" : undefined}>{label}</span>
          {line}
        </label>
      )}
      <div className="form-row">
        {/* an empty field has nothing to save: the server refuses it, so the button waits for a value */}
        <Button variant="primary" type="submit" disabled={busy || waiting || !text.trim()} aria-busy={busy || waiting || undefined}>
          {t("ow.fa_save")}
        </Button>
        {onCancel && (
          <Button onClick={onCancel}>
            {t("ow.cancel")}
          </Button>
        )}
      </div>
      {error && (
        <div className="field-error error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

/** A given input: its value and day, a way to change it and to take it away. */
function GivenRow({ row, today, scope, onChanged }: { row: InputRow; today: IsoDate; scope: Scope; onChanged: Changed }) {
  const found = inputDefOf(row.key);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!found) return null;
  const label = labelOf(found.def, found.subject);
  const remove = () => {
    setBusy(true);
    setError(null);
    api(`/api/optimise/inputs/${encodeURIComponent(row.key)}${query({ scope })}`, { method: "DELETE" })
      .then(() => onChanged(t("ow.in_removed")))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <li className="needed">
      <div className="needed-text">
        <strong>{label}</strong>
        <span>
          {valueText(found.def, row.value)} <span className="small muted">{t("ow.in_given", { date: date(row.asOf) })}</span>
        </span>
        {error && <span className="field-error error" role="alert">{error}</span>}
      </div>
      {editing ? (
        <InputForm inputKey={row.key} current={row.value} today={today} scope={scope} onSaved={(m) => { setEditing(false); onChanged(m); }} onCancel={() => setEditing(false)} quiet />
      ) : (
        <div className="form-row">
          <Button variant="link" aria-label={t("ow.in_change_aria", { label })} onClick={() => setEditing(true)}>
            {t("ow.in_change")}
          </Button>
          <Button variant="link" aria-label={t("ow.in_remove_aria", { label })} busy={busy} onClick={remove}>
            {t("ow.in_remove")}
          </Button>
        </div>
      )}
    </li>
  );
}

/** The values the household gave, each with a way to change or take it away. What is missing is asked in Tarkistettavat. */
export function InputsCard({ given, today, scope, onChanged }: { given: readonly InputRow[]; today: IsoDate; scope: Scope; onChanged: Changed }) {
  const kept = given.filter((g) => inputDefOf(g.key));
  if (!kept.length) return null;
  return (
    <Section id="tiedot" title={t("ow.in_title")}>
      <ul className="needed-list">
        {kept.map((g) => (
          <GivenRow key={g.key} row={g} today={today} scope={scope} onChanged={onChanged} />
        ))}
      </ul>
    </Section>
  );
}
