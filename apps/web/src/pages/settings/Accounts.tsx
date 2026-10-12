/**
 * Asetukset > Tilit: every account with its name, IBAN or card number, holder and
 * type (the bank's code is a guess for savings, so the type can be changed) and who uses it (AccountUse.tsx); the user's own name for any account;
 * balance and removal for the accounts the user brought in themselves (an earlier CSV import, demo). A bank account's balance comes
 * from the bank. Tietojen laatu sits under the table.
 */
import { cardLimitCents, creditAccountLoan, creditUse } from "@banking/core";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../api.ts";
import { ACCOUNT_TYPE_LABEL, accountNumber, eurosText, money, parseEuros } from "../../format.ts";
import { CONTROL_PANEL, leftOutText } from "../../consent-notices.ts";
import type { Account, Connection, Meta } from "../../types.ts";
import { isJoint, namesOther, optionsOf } from "./account-use.ts";
import { UseParts, UseSelect } from "./AccountUse.tsx";

// a bank-linked account comes back at the next link, so only an earlier CSV import or a demo one can be removed
const removable = (a: Account) => a.provider === "csv" || a.provider === "demo";

type Message = { tone: "good" | "warning"; text: string };

export function Accounts({ meta, onChange }: { meta: Meta; onChange: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  // the passing "Tallennettu." under a select: which select of which account
  const [saved, setSaved] = useState<{ what: "type" | "use"; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  // whoever can open the Enable Banking application: an admin for the shared one, the user for their own
  const canFix = meta.user.role === "admin" || meta.bank.source === "user";

  // "Tallennettu." next to a select is a passing confirmation
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 4000);
    return () => clearTimeout(t);
  }, [saved]);
  // the column of users is there when some account has a choice to make; a member alone with accounts of their own has none
  const showUse = meta.accounts.some((a) => optionsOf(a, meta).length > 1);
  const warn = (text: string) => setMessage({ tone: "warning", text });

  const setType = async (a: Account, type: string) => {
    setMessage(null);
    setSaved(null);
    try {
      await api(`/api/accounts/${encodeURIComponent(a.id)}`, { method: "PATCH", body: { type } });
      setSaved({ what: "type", id: a.id });
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
              {showUse && <th className="acc-use">Käyttäjä</th>}
              <th className="num">Saldo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {meta.accounts.map((a) => {
              // rendered twice: its own column, and under the name on a phone (settings.css)
              const type = (
                <>
                  <select value={a.type} aria-label={`Tilin ${a.name} tyyppi`} onChange={(e) => void setType(a, e.target.value)}>
                    {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  {saved?.what === "type" && saved.id === a.id && (
                    <div className="small muted" role="status">
                      Tallennettu.
                    </div>
                  )}
                </>
              );
              // the same, for who uses the account
              const users = showUse && (
                <UseSelect
                  account={a}
                  meta={meta}
                  saved={saved?.what === "use" && saved.id === a.id}
                  onSaved={() => setSaved({ what: "use", id: a.id })}
                  onChange={onChange}
                  onError={warn}
                />
              );
              // a joint account's parts, and the share for a named member who cannot see the account, in a row under it
              const parts = showUse && a.use && (isJoint(a.use) || namesOther(a.use, meta.user.id));
              // the holder is a line of its own unless the name already says it
              const holder = a.holder && a.holder !== a.name && a.holder !== a.bankName ? a.holder : null;
              // the limit and how much of it is in use, from the bank's balance (creditUse in core owns the figure)
              const limit = cardLimitCents(a.creditLimitCents);
              const loan = limit === null ? null : creditAccountLoan(a, meta.today);
              const use = loan && creditUse(loan, loan.balanceDate);
              const used = use?.usedCents ? use.usedCents : 0;
              // over the limit is said in words: the bar below tells it by colour only and a screen reader skips it
              const over = use?.overCents ? `, yli luottorajan ${money(use.overCents, false)}` : "";
              const credit = limit === null ? null : `Luottoraja ${money(limit, false)}${used ? `, käytössä ${money(used, false)}${over}` : ""}`;
              return [
                <tr key={a.id}>
                  <td>
                    {a.name}
                    <div className="sub acc-line">
                      {accountNumber(a) || "–"}
                    </div>
                    {a.customName && <div className="sub acc-line">Pankin nimi: {a.bankName}</div>}
                    {holder && <div className="sub acc-line">{holder}</div>}
                    {credit && <div className="sub acc-line">{credit}</div>}
                    {used > 0 && typeof use?.share === "number" && (
                      <div className={use.overCents ? "credit-bar over" : "credit-bar"} aria-hidden="true">
                        <span style={{ width: `${Math.min(100, Math.max(2, Math.round(use.share * 100)))}%` }} />
                      </div>
                    )}
                    <FetchProblem account={a} connection={meta.connections.find((c) => c.id === a.connectionId)} canFix={canFix} />
                    <div className="acc-type-phone">{type}</div>
                    {showUse && <div className="acc-use-phone">{users}</div>}
                  </td>
                  <td className="acc-type">{type}</td>
                  {showUse && <td className="acc-use">{users}</td>}
                  <td className="num">{a.balanceCents === null ? "–" : money(a.balanceCents)}</td>
                  <td className="num">
                    {editing !== a.id && (
                      <button className="btn btn-small" type="button" onClick={() => setEditing(a.id)} aria-label={`Muokkaa tiliä ${a.name}`}>
                        Muokkaa
                      </button>
                    )}
                  </td>
                </tr>,
                parts && (
                  <tr key={`${a.id}-use`} className="edit-row">
                    <td colSpan={5}>
                      {/* the key changes with the use and the shares, so the row asks again and starts from what is saved */}
                      <UseParts
                        key={`${JSON.stringify(a.use)}${meta.shares.filter((x) => x.accountId === a.id).map((x) => x.userId).join()}`}
                        account={a}
                        meta={meta}
                        onSaved={() => setSaved({ what: "use", id: a.id })}
                        onChange={onChange}
                        onError={warn}
                      />
                    </td>
                  </tr>
                ),
                editing === a.id && (
                  <tr key={`${a.id}-edit`} className="edit-row">
                    <td colSpan={5}>
                      <AccountForm
                        account={a}
                        busy={busy}
                        canRemove={removable(a)}
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
        {!meta.accounts.length && <div className="empty">Ei tilejä.</div>}
      </div>
    </div>
  );
}

/**
 * Why the account is not fetched. An account a newer consent of its bank did not bring says so first (its last fetch
 * problem is older than that); otherwise what its last fetch ran into, in the words of the sync message (connectors/sync.ts).
 */
function FetchProblem({ account, connection, canFix }: { account: Account; connection: Connection | undefined; canFix: boolean }) {
  const problem = account.problem;
  const leftOut = !!connection?.replaced;
  if (!leftOut && !problem) return null;
  const text = leftOut
    ? leftOutText(account.name)
    : problem!.kind === "not_linked"
      ? problem!.message.charAt(0).toUpperCase() + problem!.message.slice(1)
      : `Viimeisin haku epäonnistui: ${problem!.message}`;
  return (
    <div className="acc-problem" role="status">
      {text}
      {(leftOut || problem?.kind === "not_linked") && canFix && (
        <>
          {" "}
          <a href={CONTROL_PANEL} target="_blank" rel="noopener noreferrer">
            Avaa Control Panel
          </a>
        </>
      )}
    </div>
  );
}

function AccountForm({
  account,
  busy,
  canRemove,
  onCancel,
  onSaved,
  onRemove,
}: {
  account: Account;
  busy: boolean;
  canRemove: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onRemove: () => void;
}) {
  const csv = account.provider === "csv";
  const initialBalance = account.balanceCents === null ? "" : eurosText(account.balanceCents);
  // empty: the bank's own name shows (for an imported account, the name it was imported under)
  const [name, setName] = useState(account.customName ?? "");
  const [balance, setBalance] = useState(initialBalance);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body: { name?: string; balanceCents?: number } = {};
    if (name.trim() !== (account.customName ?? "")) body.name = name.trim();
    if (csv && balance.trim() !== initialBalance.trim()) {
      const cents = parseEuros(balance);
      if (cents === null) return setError("Anna saldo euroina, esimerkiksi 1 234,56.");
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
        <span className="field-label">Oma nimi</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={account.bankName} />
        <span className="field-help">Tyhjänä näkyy {account.bankName}.</span>
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
        {canRemove && (
          <button className="btn btn-danger" type="button" disabled={saving || busy} onClick={onRemove}>
            Poista tili
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
