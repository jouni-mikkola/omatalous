import { addDays, type ExpectedCadence } from "@banking/core";
import { type FormEvent, useRef, useState } from "react";
import { api } from "../../api.ts";
import { CADENCE_LABEL, parseEuros } from "../../format.ts";
import { t } from "../../text.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { useModal } from "../useModal.ts";
/** The cadences a typed-in bill can have, in the order of the picker. */
const BILL_CADENCES: readonly ExpectedCadence[] = ["yearly", "semiannual", "quarterly", "once"];
export const cadenceLabel = (cadence: string) => (cadence === "once" ? t("cadence.once") : (CADENCE_LABEL[cadence] ?? cadence));
/** Same window as the server: a bill that fell due last month, up to about a year and a month ahead. */
const DAYS_BACK = 31;
const DAYS_AHEAD = 400;

/**
 * The form for a bill the bank history cannot know yet, in a dialog so that it pushes nothing down. A yearly bill is
 * found after two charges, so it is typed in for its first two years. `onAdded` gets the name of the saved bill.
 */
export function BillForm({ today, onAdded, onCancel }: { today: string; onAdded: (name: string) => void; onCancel: () => void }) {
  const ref = useModal();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [cadence, setCadence] = useState<ExpectedCadence>("yearly");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bad, setBad] = useState<ReadonlySet<"name" | "amount" | "due">>(new Set());
  const fields = { name: useRef<HTMLInputElement>(null), amount: useRef<HTMLInputElement>(null), due: useRef<HTMLInputElement>(null) };
  const clear = (field: "name" | "amount" | "due") => {
    if (bad.has(field)) setBad(new Set([...bad].filter((f) => f !== field)));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amountCents = parseEuros(amount);
    const problems: { field: "name" | "amount" | "due"; text: string }[] = [];
    if (!name.trim()) problems.push({ field: "name", text: t("bills.form.name_missing") });
    if (amountCents === null || amountCents < 1) problems.push({ field: "amount", text: t("bills.form.amount_bad") });
    if (!dueDate) problems.push({ field: "due", text: t("bills.form.due_missing") });
    if (problems.length > 0 || amountCents === null) {
      setBad(new Set(problems.map((p) => p.field)));
      setError(problems[0]?.text ?? null);
      if (problems[0]) fields[problems[0].field].current?.focus();
      return;
    }
    setBad(new Set());
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
    <dialog ref={ref} className="confirm bill-dialog" aria-labelledby="bill-dialog-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="bill-dialog-title">{t("bills.form.add")}</h2>
      <form className="bill-form" onSubmit={submit}>
      <div className="bill-fields">
        <label>
          <span className="field-label">{t("bills.form.name")}</span>
          <input type="text" ref={fields.name} aria-invalid={bad.has("name") || undefined} value={name} onChange={(e) => { setName(e.target.value); clear("name"); }} maxLength={80} placeholder={t("bills.form.name_example")} autoFocus />
        </label>
        <label>
          <span className="field-label">{t("bills.form.amount")}</span>
          <input type="text" inputMode="decimal" ref={fields.amount} aria-invalid={bad.has("amount") || undefined} value={amount} onChange={(e) => { setAmount(e.target.value); clear("amount"); }} placeholder={t("bills.form.amount_example")} />
        </label>
        <label>
          <span className="field-label">{t("bills.form.due")}</span>
          <input type="date" ref={fields.due} aria-invalid={bad.has("due") || undefined} value={dueDate} onChange={(e) => { setDueDate(e.target.value); clear("due"); }} min={addDays(today, -DAYS_BACK)} max={addDays(today, DAYS_AHEAD)} />
        </label>
        <label>
          <span className="field-label">{t("bills.form.repeats")}</span>
          <select value={cadence} onChange={(e) => setCadence(e.target.value as ExpectedCadence)}>
            {BILL_CADENCES.map((c) => (
              <option key={c} value={c}>
                {cadenceLabel(c)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">{t("bills.form.note")}</p>
      <div className="form-row">
        <Button onClick={onCancel}>{t("form.cancel")}</Button>
        <Button variant="primary" type="submit" busy={saving}>
          {saving ? t("bills.form.adding") : t("bills.form.add")}
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      </form>
    </dialog>
  );
}
