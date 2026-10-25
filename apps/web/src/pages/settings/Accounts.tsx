/**
 * Asetukset > Tilit: every account with its name, IBAN or card number, holder and
 * type (the bank's code is a guess for savings, so the type can be changed) and who uses it (AccountUse.tsx); the user's own name for any account;
 * balance and removal for the accounts the user brought in themselves (an earlier CSV import, demo). A bank account's balance comes
 * from the bank. Tietojen laatu sits under the table.
 */
import { cardLimitCents, creditAccountLoan, creditUse } from "@banking/core";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../api.ts";
import { AccountMark } from "../../components/BankLogo.tsx";
import { type Column, Table } from "../../components/table/Table.tsx";
import { useApi } from "../../hooks.ts";
import { ACCOUNT_TYPE_LABEL, accountNumber, eurosText, money, moneyIn, parseEuros } from "../../format.ts";
import { CONTROL_PANEL, leftOutText } from "../../consent-notices.ts";
import type { Account, Connection, Meta } from "../../types.ts";
import { isJoint, namesOther, optionsOf } from "./account-use.ts";
import { AccountSources, hasSources } from "./AccountSources.tsx";
import { AccountSplit } from "./AccountSplit.tsx";
import { UseParts, UseSelect } from "./AccountUse.tsx";
import { type ForeignCurrency, ForeignRows } from "./ForeignRows.tsx";
import { Reconcile } from "./Reconcile.tsx";

// a bank-linked account comes back at the next link, so only an earlier CSV import or a demo one can be removed
const removable = (a: Account) => a.provider === "csv" || a.provider === "demo";

type Message = { tone: "good" | "warning"; text: string };

export function Accounts({ meta, onChange }: { meta: Meta; onChange: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  // the passing "Tallennettu." under a select: which select of which account
  const [saved, setSaved] = useState<{ what: "type" | "use"; id: string } | null>(null);
  // the account whose removal is on its way
  const [busy, setBusy] = useState<string | null>(null);
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
  const institution = (a: Account) => meta.connections.find((c) => c.id === a.connectionId)?.institution ?? null;
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
    setBusy(a.id);
    setMessage(null);
    try {
      await api(`/api/accounts/${encodeURIComponent(a.id)}`, { method: "DELETE" });
      setEditing(null);
      setMessage({ tone: "good", text: `Tili ${a.name} poistettu.` });
      onChange();
    } catch (err) {
      setMessage({ tone: "warning", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  // the rows in another currency, by account: none of them is in a euro figure
  const { data: foreign } = useApi<Record<string, ForeignCurrency[]>>("/api/foreign-rows");

  // rendered twice: its own column, and under the name on a phone (settings.css)
  const typeOf = (a: Account) => {
    return (
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
  };
  // the same, for who uses the account
  const usersOf = (a: Account) => {
    return (
      showUse && (
        <UseSelect
          account={a}
          meta={meta}
          saved={saved?.what === "use" && saved.id === a.id}
          onSaved={() => setSaved({ what: "use", id: a.id })}
          onChange={onChange}
          onError={warn}
        />
      )
    );
  };
  const nameCell = (a: Account) => {
    // the holder is a line of its own unless the name already says it
    const holder = a.holder && a.holder !== a.name && a.holder !== a.bankName ? a.holder : null;
    // what the bank says the account is, so a wrong guess of the type can be seen; the product only when the name does not already say it
    const bankSays = [a.bankTypeCode, a.bankProduct !== a.bankName && a.bankProduct !== a.name ? a.bankProduct : null].filter(Boolean).join(", ");
    // the limit and how much of it is in use, from the bank's balance (creditUse in core owns the figure)
    const limit = cardLimitCents(a.creditLimitCents);
    const loan = limit === null ? null : creditAccountLoan(a, meta.today);
    const use = loan && creditUse(loan, loan.balanceDate);
    const used = use?.usedCents ? use.usedCents : 0;
    // over the limit is said in words: the bar below tells it by colour only and a screen reader skips it
    const over = use?.overCents ? `, yli luottorajan ${money(use.overCents, false)}` : "";
    const credit = limit === null ? null : `Luottoraja ${money(limit, false)}${used ? `, käytössä ${money(used, false)}${over}` : ""}`;
    return (
      <>
        <div className="acc-name">
          <AccountMark name={a.name} institution={institution(a)} banks={meta.bank.banks ?? []} />
          <span>{a.name}</span>
        </div>
        {accountNumber(a) && <div className="sub acc-line">{accountNumber(a)}</div>}
        {a.customName && <div className="sub acc-line">Pankin nimi: {a.bankName}</div>}
        {holder && <div className="sub acc-line">{holder}</div>}
        {bankSays && <div className="sub acc-line">Pankin tilityyppi: {bankSays}</div>}
        {a.loanPayment && <div className="sub acc-line">Lainanhoitotili</div>}
        {credit && <div className="sub acc-line">{credit}</div>}
        {used > 0 && typeof use?.share === "number" && (
          <div className={use.overCents ? "credit-bar over" : "credit-bar"} aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.max(2, Math.round(use.share * 100)))}%` }} />
          </div>
        )}
        <FetchProblem account={a} connection={meta.connections.find((c) => c.id === a.connectionId)} canFix={canFix} />
        {foreign?.[a.id] && <ForeignRows currencies={foreign[a.id]!} />}
        {a.reconcile && <Reconcile result={a.reconcile} />}
      </>
    );
  };
  const editOf = (a: Account) =>
    editing !== a.id && (
      <button className="btn btn-small" type="button" onClick={() => setEditing(a.id)} aria-label={`Muokkaa tiliä ${a.name}`}>
        Muokkaa
      </button>
    );
  const columns: Column<Account>[] = [
    { key: "name", label: "Tili", kind: "text", rowHead: true, cell: nameCell },
    { key: "type", label: "Tyyppi", kind: "text", cell: typeOf },
    ...(showUse ? [{ key: "use", label: "Käyttäjä", kind: "text" as const, cell: usersOf }] : []),
    { key: "balance", label: "Saldo", kind: "money", main: true, cell: (a: Account) => (a.balanceCents === null ? "–" : moneyIn(a.balanceCents, a.currency)) },
    { key: "edit", label: "Toiminnot", headHidden: true, kind: "text", className: () => "num", cell: editOf },
  ];

  return (
    <div className="card" id="tilit">
      <div className="card-head">
        <div>
          <h2>Tilit</h2>
        </div>
      </div>
      {message && <div className={`notice ${message.tone}`}>{message.text}</div>}
      {meta.accounts.length === 0 && (
        <div className="empty">
          Tilit tulevat tähän, kun yhdistät pankin. <a href="#/settings?section=technical">Kokeile esimerkkitiedoilla</a>
        </div>
      )}
      {meta.accounts.length > 0 && (
        <Table<Account>
          caption="Tilit"
          rows={meta.accounts}
          rowKey={(a) => a.id}
          columns={columns}
          className="accounts-table"
          rowsAfter={(a) => (
            <>
              {showUse && a.use && (isJoint(a.use) || namesOther(a.use, meta.user.id)) && (
                <tr key={`${a.id}-use`} className="edit-row">
                  <td colSpan={columns.length}>
                    {/* the key changes with the use and the shares, so the row asks again and starts from what is saved */}
                    <UseParts
                      key={`${JSON.stringify(a.use)}${meta.shares
                        .filter((x) => x.accountId === a.id)
                        .map((x) => x.userId)
                        .join()}`}
                      account={a}
                      meta={meta}
                      onSaved={() => setSaved({ what: "use", id: a.id })}
                      onChange={onChange}
                      onError={warn}
                    />
                  </td>
                </tr>
              )}
              {a.use && isJoint(a.use) && a.use.users.some((u) => u.userId === meta.user.id && u.weight > 0) && <AccountSplit account={a} today={meta.today} />}
              {hasSources(a) && <AccountSources account={a} meta={meta} />}
              {editing === a.id && (
                <tr key={`${a.id}-edit`} className="edit-row">
                  <td colSpan={columns.length}>
                    <AccountForm
                      account={a}
                      busy={busy !== null}
                      removing={busy === a.id}
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
              )}
            </>
          )}
        />
      )}
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
  removing,
  canRemove,
  onCancel,
  onSaved,
  onRemove,
}: {
  account: Account;
  busy: boolean;
  /** This account's removal is on its way. */
  removing: boolean;
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
        <button className="btn btn-primary" type="submit" disabled={saving || busy} aria-busy={saving || busy || undefined}>
          {saving ? "Tallennetaan…" : "Tallenna"}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Peruuta
        </button>
        <span className="spacer" />
        {canRemove && (
          <button className="btn btn-danger" type="button" disabled={saving || busy} aria-busy={removing || undefined} onClick={onRemove}>
            Poista tili
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
