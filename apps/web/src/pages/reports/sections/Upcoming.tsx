// Decision: how much to set aside each month for rare bills
import { addDays, type ExpectedCadence } from "@banking/core";
import { type FormEvent, useState } from "react";
import { api, query } from "../../../api.ts";
import { CADENCE_LABEL, date, money, monthLong, parseEuros } from "../../../format.ts";
import { useApi } from "../../../hooks.ts";
import type { ReportsData } from "../../../types.ts";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/bills.css";

/** The cadences a typed-in bill can have, in the order of the picker. */
const BILL_CADENCES: readonly ExpectedCadence[] = ["yearly", "semiannual", "quarterly", "once"];
const cadenceLabel = (cadence: string) => (cadence === "once" ? "kerran" : (CADENCE_LABEL[cadence] ?? cadence));
/** Same window as the server: a bill that fell due last month, up to about a year and a month ahead. */
const DAYS_BACK = 31;
const DAYS_AHEAD = 400;

/**
 * Rare bills: what to set aside each month, what falls due in the next three months and in each of the next twelve,
 * and a form for the bills the bank history cannot know yet. A bill is found after two charges, so a yearly one is
 * typed in by hand for its first two years.
 */
function Upcoming({ ctx }: SectionProps) {
  // a typed-in or removed bill changes only this report: it is fetched again here, not the whole page
  const [changed, setChanged] = useState(false);
  const live = useApi<ReportsData>(changed ? `/api/reports${query({ ...ctx.range, scope: ctx.scope })}` : null);
  const r = (changed && live.data ? live.data : ctx.data).upcoming;
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setChanged(true);
    live.reload();
  };
  const remove = async (id: string) => {
    setError(null);
    try {
      await api(`/api/expected-bills/${encodeURIComponent(id)}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const biggest = Math.max(1, ...r.months.map((m) => m.cents));
  return (
    <Section id={section.id} title={section.title} sub="Laskut, joita ei makseta joka kuukausi">
      {r.advice ? (
        <p className="lead">{r.advice}</p>
      ) : (
        <p className="lead muted">
          Tähän tulevat vakuutukset, verot ja muut harvemmin maksettavat laskut. Lasku tunnistetaan, kun se on maksettu kaksi kertaa, tai lisää se itse alla.
        </p>
      )}

      {r.advice && (
        <>
          <h3 className="bills-head">
            Seuraavat kolme kuukautta <span className="muted">{date(r.from)}–{date(r.to)}</span>
          </h3>
          {r.items.length ? (
            <ul className="bill-list">
              {r.items.map((i, n) => (
                <li key={`${i.source}-${i.merchant}-${i.date}-${n}`}>
                  <div className="bill-line">
                    <span className="bill-name">
                      {i.source === "detected" ? <a href={`#/transactions${query({ merchant: i.merchant })}`}>{i.merchant}</a> : i.merchant}
                      {i.source === "manual" && <span className="badge">lisätty käsin</span>}
                    </span>
                    <strong>{money(i.amountCents)}</strong>
                  </div>
                  <div className="sub">
                    {date(i.date)} · {i.category ? `${ctx.label(i.category)} · ` : ""}
                    {cadenceLabel(i.cadence)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Seuraavan kolmen kuukauden aikana ei erääny tällaisia laskuja.</p>
          )}

          <h3 className="bills-head">Seuraavat 12 kuukautta</h3>
          <ul className="bill-months">
            {r.months.map((m) => (
              <li key={m.month}>
                <div className="bill-month-head">
                  <span>{monthLong(m.month)}</span>
                  <strong>{m.cents ? money(m.cents, false) : "–"}</strong>
                </div>
                {m.cents > 0 && (
                  <div className="bill-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, (m.cents / biggest) * 100)}%` }} />
                  </div>
                )}
                {m.names.length > 0 && <div className="sub">{m.names.join(", ")}</div>}
              </li>
            ))}
          </ul>
        </>
      )}

      {r.manual.length > 0 && (
        <>
          <h3 className="bills-head">Lisäämäsi laskut</h3>
          <ul className="bill-list">
            {r.manual.map((b) => (
              <li key={b.id}>
                <div className="bill-line">
                  <span className="bill-name">{b.name}</span>
                  <strong>{money(b.amountCents)}</strong>
                  <button className="btn btn-small btn-danger" type="button" aria-label={`Poista lasku ${b.name}`} onClick={() => remove(b.id)}>
                    Poista
                  </button>
                </div>
                <div className="sub">
                  {cadenceLabel(b.cadence)} · {b.nextDate ? `seuraava ${date(b.nextDate)}` : `erääntyi ${date(b.dueDate)}`}
                </div>
                {!b.counted && <div className="sub">Lasku on jo tunnistettu tapahtumista, eikä sitä lasketa kahdesti.</div>}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <div className="error" role="alert">{error}</div>}

      <BillForm today={ctx.meta.today} onAdded={refresh} />
    </Section>
  );
}

function BillForm({ today, onAdded }: { today: string; onAdded: () => void }) {
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
      setName("");
      setAmount("");
      setDueDate("");
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="bill-form" aria-label="Lisää odotettu lasku" onSubmit={submit}>
      <h3 className="bills-head">Lisää odotettu lasku</h3>
      <div className="bill-fields">
        <label>
          <span className="field-label">Nimi</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ajoneuvovero" />
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
      <p className="muted small">Anna seuraava eräpäivä. Toistuva lasku jatkuu siitä samana päivänä.</p>
      <div className="form-row">
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? "Lisätään…" : "Lisää lasku"}
        </button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </form>
  );
}

export const section: ReportSection = {
  id: "tulevat",
  title: "Tulevat laskut",
  order: 70,
  reports: ["upcoming"],
  Component: Upcoming,
};
