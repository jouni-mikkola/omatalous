// Decision: does the household slow down this month to keep to the spending goal it set, and by how much a day
import type { SpendingGoal as Goal } from "@banking/core";
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { eurosText, money, parseEuros } from "../../format.ts";
import { estimateRange } from "../../charts/PaceChart.tsx";

/** The month's end as the goal's sentence says it: a range from the usual months, one figure on the last day. */
const endText = (end: NonNullable<Goal["end"]>) => (end.low === end.high ? money(end.low, false) : estimateRange(end.low, end.high));

/** Where the month stands against the goal, in sentences: what is left, how the month ends, and what a day may cost. */
export function goalAnswer(goal: Goal): string {
  const { cents, leftCents, end, perDayCents, state } = goal;
  if (state === "over") return `Tavoite ${money(cents, false)} on ylittynyt: menoja on ${money(-leftCents, false)} yli.`;
  const left = `Tavoitteesta ${money(cents, false)} on jäljellä ${money(leftCents, false)}.`;
  const perDay = perDayCents === null ? "" : ` Päivässä voi kuluttaa enintään ${money(perDayCents, false)}.`;
  if (!end) return left + perDay;
  const ends = `Kuukausi päättyy ${endText(end)}`;
  if (state === "above") return `${left} ${ends}, tavoitteen yli.${perDay}`;
  if (state === "near") return `${left} ${ends}, tavoite on tällä välillä.${perDay}`;
  return `${left} ${ends}, tavoitteen sisällä.${perDay}`;
}

/**
 * Under the chart of Menot tässä kuussa: the goal's sentence with its buttons, or the button that sets one. One goal for
 * the month's spending, no goals per category. `onChanged` reloads the dashboard that carries the goal.
 */
export function SpendingGoalBar({ goal, onChanged }: { goal: Goal | null; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (call: () => Promise<unknown>, done: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await call();
      done();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = () => {
    setText(goal ? eurosText(goal.cents) : "");
    setError(null);
    setEditing(true);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const monthlyCents = parseEuros(text);
    if (monthlyCents === null || monthlyCents < 100) return setError("Anna tavoite euroina, esimerkiksi 2 500.");
    void run(() => api("/api/spending-goal", { method: "PUT", body: { monthlyCents } }), () => setEditing(false));
  };
  const remove = () => void run(() => api("/api/spending-goal", { method: "DELETE" }), () => {});

  return (
    <div className="pace-goal">
      {editing ? (
        <form className="form-row" aria-label="Kuukauden menotavoite" onSubmit={save}>
          <label>
            <span className="field-label">Menotavoite kuussa, €</span>{" "}
            <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="2 500" autoFocus />
          </label>
          <button className="btn btn-primary btn-small" type="submit" disabled={busy} aria-busy={busy || undefined}>
            Tallenna
          </button>
          <button className="btn btn-small" type="button" onClick={() => setEditing(false)}>
            Peruuta
          </button>
        </form>
      ) : (
        <div className="form-row">
          {goal && <p className="pace-goal-answer">{goalAnswer(goal)}</p>}
          <button className="btn btn-small" type="button" onClick={open}>
            {goal ? "Muuta tavoitetta" : "Aseta kuukauden menotavoite"}
          </button>
          {goal && (
            <button className="btn btn-small btn-danger" type="button" onClick={remove} disabled={busy} aria-busy={busy || undefined}>
              Poista tavoite
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
