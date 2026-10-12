import { addDays, type ExpectedCadence } from "@banking/core";
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { CADENCE_LABEL, parseEuros } from "../../format.ts";

/** The cadences a typed-in bill can have, in the order of the picker. */
const BILL_CADENCES: readonly ExpectedCadence[] = ["yearly", "semiannual", "quarterly", "once"];
export const cadenceLabel = (cadence: string) => (cadence === "once" ? "kerran" : (CADENCE_LABEL[cadence] ?? cadence));
/** Same window as the server: a bill that fell due last month, up to about a year and a month ahead. */
const DAYS_BACK = 31;
const DAYS_AHEAD = 400;

/**
 * The form for a bill the bank history cannot know yet. A yearly bill is found after two charges, so it is typed in
 * for its first two years. `onAdded` gets the name of the saved bill.
 */
export function BillForm({ today, onAdded }: { today: string; onAdded: (name: string) => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [cadence, setCadence] = useState<ExpectedCadence>("yearly");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amountCents = parseEuros(amount);
    if (!name.trim()) return setError("Anna laskulle nimi.");
    if (amountCents === null || amountCents < 1) return setError("Anna summa euroina, esimerkiksi 312,50.");
    if (!dueDate) return setError("Valitse eräpäivä.");
    setSaving(true);
    setError(null);
    try {
      await api("/api/expected-bills", { method: "POST", body: { name: name.trim(), amountCents, dueDate, cadence } });
      onAdded(name.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="bill-form" aria-label="Lisää lasku" onSubmit={submit}>
      <div className="bill-fields">
        <label>
          <span className="field-label">Nimi</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ajoneuvovero" autoFocus />
        </label>
        <label>
          <span className="field-label">Summa</span>
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="312,50" />
        </label>
        <label>
          <span className="field-label">Eräpäivä</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={addDays(today, -DAYS_BACK)} max={addDays(today, DAYS_AHEAD)} />
        </label>
        <label>
          <span className="field-label">Toistuu</span>
          <select value={cadence} onChange={(e) => setCadence(e.target.value as ExpectedCadence)}>
            {BILL_CADENCES.map((c) => (
              <option key={c} value={c}>
                {cadenceLabel(c)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">
        Anna seuraava eräpäivä. Toistuva lasku erääntyy sen jälkeen aina samana päivänä. Pankin tapahtumista lasku tunnistetaan, kun se on maksettu kahdesti.
      </p>
      <div className="form-row">
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? "Lisätään…" : "Lisää lasku"}
        </button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </form>
  );
}
