/** The numbers a household may type in: the old value and day, and the form that stores it. */
import { addMonthsToDate, type InputDef, inputDefOf, type InputRow, type InputValue, type IsoDate, type NeededInput } from "@banking/core";
import { type FormEvent, useState } from "react";
import { api, query } from "../../api.ts";
import { date, eurosText, money, parseEuros, rateText } from "../../format.ts";
import type { Scope } from "../../types.ts";
import { Section } from "../Section.tsx";
import { type Changed, subjectName } from "./shared.tsx";

const num = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 2 });
/** A margin is stored in hundredths of a percent: 125 is 1,25 %. */
const percent = (bp: number) => `${num.format(bp / 100)} %`;

/** The label of an input, with the subscription it belongs to for a quote. */
function labelOf(def: InputDef, subject: string | null): string {
  return subject ? `${def.label}: ${subjectName(subject)}` : def.label;
}

/** A stored value as a person reads it ("12 000 km vuodessa", "Kerrostalo"). */
export function valueText(def: InputDef, value: InputValue): string {
  switch (def.kind) {
    case "integer":
      return `${num.format(value as number)} ${def.unit ?? ""}`.trim();
    case "cents":
      return `${money(value as number, false)} vuodessa`;
    case "date":
      return date(value as string);
    case "choice":
      return def.choices!.find((c) => c.id === value)?.label ?? String(value);
    case "loan_rate": {
      const rate = value as { marginBp: number; reference: string };
      return `${percent(rate.marginBp)} ja ${def.choices!.find((c) => c.id === rate.reference)?.label ?? rate.reference}`;
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
export function InputForm({ inputKey, current, today, scope, onSaved, onCancel, quiet }: {
  inputKey: string;
  current?: InputValue;
  today: IsoDate;
  scope: Scope;
  onSaved: Changed;
  onCancel?: () => void;
  /** The label is already shown beside the form: screen readers still get it. */
  quiet?: boolean;
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
    setBusy(true);
    setError(null);
    api(`/api/optimise/inputs/${encodeURIComponent(inputKey)}${query({ scope })}`, { method: "PUT", body: { value: valueToSend() } })
      .then(() => onSaved("Tieto tallennettu."))
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
            <option value="">Valitse</option>
            {def.choices!.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        );
      case "loan_rate":
        return (
          <>
            <input type="text" inputMode="decimal" size={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Marginaali prosentteina" aria-invalid={error ? true : undefined} />
            <span className="muted">%</span>
            <select value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Viitekorko">
              {def.choices!.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </>
        );
      default:
        return (
          <>
            <input type="text" inputMode={def.kind === "cents" ? "decimal" : "numeric"} size={9} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={error ? true : undefined} />
            {def.unit && <span className="muted">{def.unit}</span>}
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
        <button className="btn btn-small btn-primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
          Tallenna
        </button>
        {onCancel && (
          <button className="btn btn-small" type="button" onClick={onCancel}>
            Peruuta
          </button>
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

/** One input the checks wait for or that went stale: its name, the old value, the form. */
function NeededRow({ need, today, scope, onChanged }: { need: NeededInput; today: IsoDate; scope: Scope; onChanged: Changed }) {
  const found = inputDefOf(need.key);
  if (!found) return null;
  return (
    <li className="needed">
      <div className="needed-text">
        <strong>{labelOf(found.def, found.subject)}</strong>
        {need.old && (
          <span className="small stale">
            Vanha arvo {valueText(found.def, need.old.value)}, annettu {date(need.old.asOf)}. Liian vanha, ei käytetä.
          </span>
        )}
      </div>
      <InputForm inputKey={need.key} today={today} scope={scope} onSaved={onChanged} quiet />
    </li>
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
      .then(() => onChanged("Tieto poistettu."))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <li className="needed">
      <div className="needed-text">
        <strong>{label}</strong>
        <span>
          {valueText(found.def, row.value)} <span className="small muted">annettu {date(row.asOf)}</span>
        </span>
        {error && <span className="field-error error" role="alert">{error}</span>}
      </div>
      {editing ? (
        <InputForm inputKey={row.key} current={row.value} today={today} scope={scope} onSaved={(m) => { setEditing(false); onChanged(m); }} onCancel={() => setEditing(false)} quiet />
      ) : (
        <div className="form-row">
          <button className="btn btn-small" type="button" aria-label={`Muuta: ${label}`} onClick={() => setEditing(true)}>
            Muuta
          </button>
          <button className="btn btn-small" type="button" aria-label={`Poista: ${label}`} disabled={busy} aria-busy={busy || undefined} onClick={remove}>
            Poista
          </button>
        </div>
      )}
    </li>
  );
}

export function InputsCard({ needed, given, today, scope, onChanged }: { needed: readonly NeededInput[]; given: readonly InputRow[]; today: IsoDate; scope: Scope; onChanged: Changed }) {
  const waiting = new Set(needed.map((n) => n.key));
  const kept = given.filter((g) => !waiting.has(g.key) && inputDefOf(g.key));
  if (!needed.length && !kept.length) return null;
  return (
    <Section id="tiedot" title="Tiedot, joita tarvitaan">
      {needed.length > 0 && (
        <ul className="needed-list">
          {needed.map((n) => (
            <NeededRow key={n.key} need={n} today={today} scope={scope} onChanged={onChanged} />
          ))}
        </ul>
      )}
      {kept.length > 0 && (
        <>
          <h3 className="optimise-subhead">Annetut tiedot</h3>
          <ul className="needed-list">
            {kept.map((g) => (
              <GivenRow key={g.key} row={g} today={today} scope={scope} onChanged={onChanged} />
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
