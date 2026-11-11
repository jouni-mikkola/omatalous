/**
 * Asetukset > Tilit: every account with its name, IBAN or card number, holder and
 * type (the bank's code is a guess for savings, so the type can be changed) and who uses it (AccountUse.tsx); the user's own name for any account;
 * balance and removal for the accounts the user brought in themselves (an earlier CSV import, demo). A bank account's balance comes
 * from the bank. Tietojen laatu sits under the table.
 */
import { cardLimitCents, creditAccountLoan, creditUse } from "@banking/core";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import { type Column, Table } from "../../components/table/Table.tsx";
import { useApi } from "../../hooks.ts";
import { ACCOUNT_TYPE_LABEL, accountNumber, eurosText, money, moneyIn, parseEuros } from "../../format.ts";
import { CONTROL_PANEL, leftOutText } from "../../consent-notices.ts";
import type { Account, Connection, Meta } from "../../types.ts";
import { isJoint, namesOther, optionsOf } from "./account-use.ts";
import { AccountSplit } from "./AccountSplit.tsx";
import { UseParts, UseSelect } from "./AccountUse.tsx";
import { type ForeignCurrency, ForeignRows } from "./ForeignRows.tsx";
import { Reconcile } from "./Reconcile.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { Empty } from "../../components/ui/Empty.tsx";
import { SETTINGS_ANCHOR, settingsHash } from "../../routes.ts";
import { AccountShares } from "./AccountShares.tsx";
import { css } from "../../css.ts";
import { t } from "../../text.ts";
// a bank-linked account comes back at the next link, so only an earlier CSV import, a card statement or a demo one can be removed
const removable = (a: Account) => a.provider === "csv" || a.provider === "cardfile" || a.provider === "bankfile" || a.provider === "demo";

type Message = { tone: "good" | "warning"; text: string };

export function Accounts({ meta, onChange }: { meta: Meta; onChange: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  // the account whose form just closed: its Muokkaa takes the focus back, which otherwise falls to the page's start
  const back = useRef<string | null>(null);
  const table = useRef<HTMLDivElement>(null);
  const close = (id: string) => {
    back.current = id;
    setEditing(null);
  };
  useEffect(() => {
    if (editing !== null || back.current === null) return;
    table.current?.querySelector<HTMLElement>(`[data-edit="${CSS.escape(back.current)}"]`)?.focus();
    back.current = null;
  }, [editing]);
  const [removing, setRemoving] = useState<Account | null>(null);
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
    const timer = setTimeout(() => setSaved(null), 4000);
    return () => clearTimeout(timer);
  }, [saved]);
  // the choice of users is there when some account has a choice to make; a member alone with accounts of their own has none
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
    setRemoving(null);
    setBusy(a.id);
    setMessage(null);
    try {
      await api(`/api/accounts/${encodeURIComponent(a.id)}`, { method: "DELETE" });
      setEditing(null);
      setMessage({ tone: "good", text: t("set.acc.account_name_removed", { name: a.name }) });
      onChange();
    } catch (err) {
      setMessage({ tone: "warning", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  // the rows in another currency, by account: none of them is in a euro figure
  const { data: foreign } = useApi<Record<string, ForeignCurrency[]>>("/api/foreign-rows");

  // the type and the user are changed in the edit form of the row: they are rarely needed and every row had two selects
  const typeOf = (a: Account) => {
    return (
      <>
        <select value={a.type} aria-label={t("set.acc.type_of_account_name", { name: a.name })} onChange={(e) => void setType(a, e.target.value)}>
          {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {saved?.what === "type" && saved.id === a.id && (
          <div className="small muted" role="status">
            {t("set.acc.saved")}
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
  // what the bank says the account is, so a wrong guess of the type can be seen when it is changed; the product only when the name does not already say it
  const bankSaysOf = (a: Account) => [a.bankTypeCode, a.bankProduct !== a.bankName && a.bankProduct !== a.name ? a.bankProduct : null].filter(Boolean).join(", ");
  const nameCell = (a: Account) => {
    // the holder is a line of its own unless the name already says it
    const holder = a.holder && a.holder !== a.name && a.holder !== a.bankName ? a.holder : null;
    // the limit and how much of it is in use, from the bank's balance (creditUse in core owns the figure)
    const limit = cardLimitCents(a.creditLimitCents);
    const loan = limit === null ? null : creditAccountLoan(a, meta.today);
    const use = loan && creditUse(loan, loan.balanceDate);
    const used = use?.usedCents ? use.usedCents : 0;
    // over the limit is said in words: the bar below tells it by colour only and a screen reader skips it
    const over = use?.overCents ? t("set.acc.over_the_credit_limit_by", { amount: money(use.overCents, false) }) : "";
    const credit = limit === null ? null : t("set.acc.credit_limit", { limit: money(limit, false) }) + (used ? t("set.acc.credit_used", { used: money(used, false) }) + over : "");
    return (
      <>
        <div className="acc-name">{a.name}</div>
        {accountNumber(a) && <div className="sub acc-line">{accountNumber(a)}</div>}
        {a.customName && <div className="sub acc-line">{t("set.acc.bank_name", { name: a.bankName })}</div>}
        {holder && <div className="sub acc-line">{holder}</div>}
        {a.loanPayment && <div className="sub acc-line">{t("set.acc.loan_payment_account")}</div>}
        {credit && <div className="sub acc-line">{credit}</div>}
        {used > 0 && typeof use?.share === "number" && (
          <div className={use.overCents ? "credit-bar over" : "credit-bar"} aria-hidden="true">
            <span ref={css({ width: `${Math.min(100, Math.max(2, Math.round(use.share * 100)))}%` })} />
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
      <Button variant="link" data-edit={a.id} onClick={() => setEditing(a.id)} aria-label={t("set.acc.edit_account_name", { name: a.name })}>
        {t("set.acc.edit")}
      </Button>
    );
  const columns: Column<Account>[] = [
    { key: "name", label: t("set.acc.account"), kind: "text", rowHead: true, cell: nameCell },
    { key: "balance", label: t("set.acc.balance"), kind: "money", main: true, cell: (a: Account) => (a.balanceCents === null ? "–" : moneyIn(a.balanceCents, a.currency)) },
    { key: "edit", label: t("set.acc.actions"), headHidden: true, kind: "text", className: () => "num", cell: editOf },
  ];

  return (
    <div className="card" id="tilit" ref={table}>
      <div className="card-head">
        <div>
          <h2>{t("set.acc.accounts")}</h2>
        </div>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {meta.accounts.length === 0 && (
        <Empty>
          {t("set.acc.accounts_appear_here")} {!meta.householdHasAccounts && <a href={settingsHash("banks", SETTINGS_ANCHOR.exampleData)}>{t("set.acc.try_sample_data")}</a>}
        </Empty>
      )}
      {meta.accounts.length > 0 && (
        <Table<Account>
          caption={t("set.acc.accounts")}
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
              {editing === a.id && (
                <tr key={`${a.id}-edit`} className="edit-row">
                  <td colSpan={columns.length}>
                    <AccountForm
                      account={a}
                      meta={meta}
                      type={typeOf(a)}
                      use={showUse && optionsOf(a, meta).length > 1 ? usersOf(a) : null}
                      bankSays={bankSaysOf(a)}
                      onChange={onChange}
                      busy={busy !== null}
                      removing={busy === a.id}
                      canRemove={removable(a)}
                      onCancel={() => close(a.id)}
                      onSaved={() => {
                        close(a.id);
                        setMessage({ tone: "good", text: t("set.acc.saved") });
                        onChange();
                      }}
                      onRemove={() => setRemoving(a)}
                    />
                  </td>
                </tr>
              )}
            </>
          )}
        />
      )}
      {removing && (
        <ConfirmDialog title={t("set.acc.remove_the_account_name", { name: removing.name })} confirmLabel={t("set.acc.remove_account")} onConfirm={() => void remove(removing)} onCancel={() => setRemoving(null)}>
          <p>{t("set.acc.the_account_s_transactions_are")}</p>
        </ConfirmDialog>
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
      : t("set.acc.the_latest_fetch_failed_message", { message: problem!.message });
  return (
    <div className="acc-problem" role="status">
      {text}
      {(leftOut || problem?.kind === "not_linked") && canFix && (
        <>
          {" "}
          <a href={CONTROL_PANEL} target="_blank" rel="noopener noreferrer">
            {t("set.acc.open_control_panel")}
          </a>
        </>
      )}
    </div>
  );
}

function AccountForm({
  account,
  meta,
  type,
  use,
  bankSays,
  onChange,
  busy,
  removing,
  canRemove,
  onCancel,
  onSaved,
  onRemove,
}: {
  account: Account;
  meta: Meta;
  /** The selects of the type and of who uses the account; each saves at once. `use` is null when there is no choice to make. */
  type: ReactNode;
  use: ReactNode;
  /** What the bank says the account is; empty when it says nothing. */
  bankSays: string;
  /** The shares save at once, so the page reads the answer again. */
  onChange: () => void;
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
      if (cents === null) return setError(t("set.acc.enter_the_balance_in_euros"));
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
        <span className="field-label">{t("set.acc.account_name")}</span>
        {/* the form opens in place of the Muokkaa that was pressed, so the focus moves into it */}
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={account.bankName} autoFocus />
        <span className="field-help">{t("set.acc.name_empty", { name: account.bankName })}</span>
      </label>
      <label>
        <span className="field-label">{t("set.acc.type")}</span>
        {type}
        {bankSays && <span className="field-help">{t("set.acc.bank_type", { type: bankSays })}</span>}
      </label>
      {use && (
        <label>
          <span className="field-label">{t("set.acc.user")}</span>
          {use}
        </label>
      )}
      {csv && (
        <label>
          <span className="field-label">{t("set.acc.balance_now")}</span>
          <input type="text" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder={eurosText(123456)} />
        </label>
      )}
      <AccountShares accountId={account.id} meta={meta} onChange={onChange} />
      <div className="form-row">
        <Button variant="primary" type="submit" busy={saving || busy}>
          {saving ? t("set.acc.saving") : t("set.acc.save")}
        </Button>
        <Button onClick={onCancel}>
          {t("set.acc.cancel")}
        </Button>
        <span className="spacer" />
        {canRemove && (
          <Button disabled={saving || busy} aria-busy={removing || undefined} onClick={onRemove}>
            {t("set.acc.remove_account")}
          </Button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}
