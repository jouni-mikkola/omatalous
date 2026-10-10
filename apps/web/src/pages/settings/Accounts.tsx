/**
 * Asetukset > Tilit: account type for every account; name, balance and
 * removal for the accounts the user brought in themselves (CSV, demo).
 * A bank account's name and balance come from the bank.
 */
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../api.ts";
import { ACCOUNT_TYPE_LABEL, dateTime, money, parseEuros } from "../../format.ts";
import type { Account, Meta } from "../../types.ts";

const PROVIDER_LABEL: Record<string, string> = { enablebanking: "pankkiyhteys", csv: "CSV", demo: "demo" };
const editable = (a: Account) => a.provider === "csv" || a.provider === "demo";
const euros = new Intl.NumberFormat("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Message = { tone: "good" | "warning"; text: string };

export function Accounts({ meta, onChange }: { meta: Meta; onChange: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [savedType, setSavedType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  // "Tallennettu." next to a type select is a passing confirmation
  useEffect(() => {
    if (!savedType) return;
    const t = setTimeout(() => setSavedType(null), 4000);
    return () => clearTimeout(t);
  }, [savedType]);

  const setType = async (a: Account, type: string) => {
    setMessage(null);
    setSavedType(null);
    try {
      await api(`/api/accounts/${encodeURIComponent(a.id)}`, { method: "PATCH", body: { type } });
      setSavedType(a.id);
      onChange();
    } catch (err) {
      setMessage({ tone: "warning", text: (err as Error).message });
    }
  };

  const remove = async (a: Account) => {
    if (!window.confirm(`Poistetaanko tili ${a.name} ja sen tapahtumat?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/accounts/${encodeURIComponent(a.id)}`, { method: "DELETE" });
      setEditing(null);
      setMessage({ tone: "good", text: `Tili ${a.name} poistettu.` });
      onChange();
    } catch (err) {
      setMessage({ tone: "warning", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" id="tilit">
      <div className="card-head">
        <div>
          <h2>Tilit</h2>
        </div>
      </div>
      {message && <div className={`notice ${message.tone}`}>{message.text}</div>}
      <div className="table-wrap">
        <table className="accounts-table">
          <thead>
            <tr>
              <th>Tili</th>
              <th className="acc-type">Tyyppi</th>
              <th className="num">Saldo</th>
              <th className="hide-phone">Haettu</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {meta.accounts.map((a) => {
              // rendered twice: its own column, and under the name on a phone (styles.css)
              const type = (
                <>
                  <select value={a.type} aria-label={`Tilin ${a.name} tyyppi`} onChange={(e) => void setType(a, e.target.value)}>
                    {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  {savedType === a.id && (
                    <div className="small muted" role="status">
                      Tallennettu.
                    </div>
                  )}
                </>
              );
              return [
                <tr key={a.id}>
                  <td>
                    {a.name}
                    <div className="sub">
                      {a.iban ?? "–"} · {PROVIDER_LABEL[a.provider] ?? a.provider}
                    </div>
                    <div className="acc-type-phone">{type}</div>
                  </td>
                  <td className="acc-type">{type}</td>
                  <td className="num">{a.balanceCents === null ? "–" : money(a.balanceCents)}</td>
                  <td className="hide-phone">{dateTime(a.lastSyncedAt ?? a.balanceAt)}</td>
                  <td className="num">
                    {editable(a) && editing !== a.id && (
                      <button className="btn btn-small" type="button" onClick={() => setEditing(a.id)} aria-label={`Muokkaa tiliä ${a.name}`}>
                        Muokkaa
                      </button>
                    )}
                  </td>
                </tr>,
                editing === a.id && (
                  <tr key={`${a.id}-edit`} className="edit-row">
                    <td colSpan={5}>
                      <AccountForm
                        account={a}
                        busy={busy}
                        onCancel={() => setEditing(null)}
                        onSaved={() => {
                          setEditing(null);
                          setMessage({ tone: "good", text: "Tallennettu." });
                          onChange();
                        }}
                        onRemove={() => void remove(a)}
                      />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
        {!meta.accounts.length && <div className="empty">Ei tilejä vielä.</div>}
      </div>
    </div>
  );
}

function AccountForm({ account, busy, onCancel, onSaved, onRemove }: { account: Account; busy: boolean; onCancel: () => void; onSaved: () => void; onRemove: () => void }) {
  const csv = account.provider === "csv";
  const initialBalance = account.balanceCents === null ? "" : euros.format(account.balanceCents / 100);
  const [name, setName] = useState(account.name);
  const [balance, setBalance] = useState(initialBalance);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body: { name?: string; balanceCents?: number } = {};
    if (name.trim() && name.trim() !== account.name) body.name = name.trim();
    if (csv && balance.trim() !== initialBalance.trim()) {
      const cents = parseEuros(balance);
      if (cents === null) return setError("Anna saldo euroina, esim. 1 234,56.");
      body.balanceCents = cents;
    }
    if (!Object.keys(body).length) return onCancel();
    setSaving(true);
    setError(null);
    try {
      await api(`/api/accounts/${encodeURIComponent(account.id)}`, { method: "PATCH", body });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="account-form" onSubmit={save}>
      <label>
        <span className="field-label">Nimi</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      </label>
      {csv && (
        <label>
          <span className="field-label">Saldo nyt</span>
          <input type="text" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="1 234,56" />
        </label>
      )}
      <div className="form-row">
        <button className="btn btn-primary" type="submit" disabled={saving || busy}>
          {saving ? "Tallennetaan…" : "Tallenna"}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Peruuta
        </button>
        <span className="spacer" />
        <button className="btn btn-danger" type="button" disabled={saving || busy} onClick={onRemove}>
          Poista tili
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
