/**
 * Asetukset > Tilit: who uses each account. `UseSelect` is the choice in a row (it saves at once, as the type does), `UseParts`
 * sits in a row under it for a joint account's split (one control, AccountSplit.tsx), its offer and answers and for a user who cannot see the account, and `LinkQuestion` asks about
 * the joint accounts a consent just brought. What each choice sends is account-use.ts; the server keeps the use (routes/finance.ts).
 */
import { useState } from "react";
import { api } from "../../api.ts";
import { accountNumber } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { partAnchor } from "../../part.ts";
import type { Account, AccountQuestion, Meta } from "../../types.ts";
import { answerLabel, type Call, choiceOf, isJoint, offerText, optionsOf, ownersOf, peopleOf, questionLabel, questionOf, type Said, takeBackCall, usersFor } from "./account-use.ts";
import { AccountSplit } from "./AccountSplit.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";
type Choices = Pick<Meta, "user" | "members">;

const accountUrl = (account: Pick<Account, "id">, part: string) => `/api/accounts/${encodeURIComponent(account.id)}/${part}`;
const useUrl = (account: Pick<Account, "id">) => accountUrl(account, "use");
const putUse = (account: Pick<Account, "id">, users: Said[]) => api(useUrl(account), { method: "PUT", body: { users } });

/** The select with a name for the account it belongs to; the choices are the options of account-use.ts. */
function ChoiceSelect({ value, account, meta, onPick }: { value: string; account: Account; meta: Choices; onPick: (choice: string) => void }) {
  return (
    <select value={value} aria-label={t("set.acuse.user_of_account", { name: account.name })} onChange={(e) => onPick(e.target.value)}>
      {optionsOf(account, meta).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Who uses the account, for a row of Tilit. `saved` is the passing "Tallennettu." under it. */
export function UseSelect({ account, meta, saved, onSaved, onChange, onError }: { account: Account; meta: Meta; saved: boolean; onSaved: () => void; onChange: () => void; onError: (text: string) => void }) {
  const use = account.use;
  if (!use) return null;
  const options = optionsOf(account, meta);
  if (options.length < 2) return <>{t("set.acuse.me")}</>;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onSaved();
      onChange();
    } catch (err) {
      onError((err as Error).message);
    }
  };
  return (
    <>
      <ChoiceSelect value={choiceOf(use)} account={account} meta={meta} onPick={(choice) => void run(() => putUse(account, usersFor(choice, account, meta)))} />
      {saved && (
        <div className="small muted" role="status">
          {t("set.acuse.saved")}
        </div>
      )}
      {use.source === "said" && (
        <div className="small">
          <Button variant="link" onClick={() => void run(() => api(useUrl(account), { method: "DELETE" }))}>
            {t("set.acuse.reset_to_the_bank_s")}
          </Button>
        </div>
      )}
    </>
  );
}

/** The members the use names who cannot see the account (GET .../use/suggestion). */
interface Suggestion {
  unseen: string[];
}

/**
 * The row under an account that is a joint account or names another member: the split of a joint account (AccountSplit)
 * with the offer and the answers of the money trace, and a line with the share for each named member who cannot see the
 * account. Rendered with a key that changes with the use and the shares, so it starts from what is saved.
 */
export function UseParts({ account, meta, onSaved, onChange, onError }: { account: Account; meta: Meta; onSaved: () => void; onChange: () => void; onError: (text: string) => void }) {
  const use = account.use!;
  const people = peopleOf(account, meta);
  const owners = ownersOf(account, meta);
  const [error, setError] = useState<string | null>(null);
  // what is on its way: the offer, an answer taken back
  const [busy, setBusy] = useState<string | null>(null);
  const { data } = useApi<Suggestion>(`${useUrl(account)}/suggestion`);

  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
      onSaved();
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const putSource = () => api(accountUrl(account, "split"), { method: "PUT", body: { mode: "source" } });
  const working = (q: Pick<AccountQuestion, "kind" | "key">) => busy === `${q.kind}:${q.key}`;
  const send = (call: Call) => void act(`${call.body.kind}:${call.body.key}`, () => api(call.path, { method: call.method, body: call.body }));
  const share = async (userId: string) => {
    try {
      await api(`${accountUrl(account, "shares")}/${encodeURIComponent(userId)}`, { method: "PUT" });
      onChange();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const answers = account.answers ?? [];
  return (
    <div className="use-parts" id={partAnchor(account.id)}>
      {isJoint(use) && (
        <>
          <AccountSplit account={account} meta={meta} onSaved={onSaved} onChange={onChange} />
          {account.offer && (
            <ul className="use-list">
              <li className="use-row">
                <span className="use-label">{t("set.acuse.paid_into_account")}</span>
                <span className="use-sum">{offerText(account.offer, people)}</span>
                <span className="use-actions">
                  <Button variant="link" disabled={busy !== null} aria-busy={busy === "offer" || undefined} onClick={() => void act("offer", putSource)}>
                    {t("set.acuse.use_this")}
                  </Button>
                </span>
              </li>
            </ul>
          )}
          {answers.length > 0 && (
            <>
              <h3 className="use-head">{t("set.acuse.answers")}</h3>
              <ul className="use-list">
                {answers.map((a) => (
                  <li key={`${a.kind}:${a.key}`} className="use-row">
                    <span className="use-label">{questionLabel(a)}</span>
                    <span className="use-sum">{answerLabel(a.owner, owners)}</span>
                    <span className="use-actions">
                      <Button variant="link" disabled={busy !== null} aria-busy={working(a) || undefined} aria-label={t("set.acuse.remove_answer", { label: questionLabel(a) })} onClick={() => send(takeBackCall(account.id, a))}>
                        {t("set.acuse.remove")}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {data?.unseen.map((id) => (
        <div key={id} className="use-line small" role="status">
          <span>{t("set.acuse.cannot_see_account", { name: meta.members.find((m) => m.id === id)?.displayName ?? t("set.acuse.user") })}</span>
          <Button variant="link" onClick={() => void share(id)}>
            {t("set.acuse.share_account")}
          </Button>
        </div>
      ))}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

/**
 * The question after a consent: the new accounts with two holders or more, each with the choice the bank's holders give
 * already made. One press says each as shown. It is shown on the visit that ended the consent only (BankConnections).
 */
export function LinkQuestion({ meta, onChange, onSaved }: { meta: Meta; onChange: () => void; onSaved: (message: { tone: "good"; text: string }) => void }) {
  const accounts = questionOf(meta);
  // only what the member changed: the rest stays what the bank gives, also when a later look at the page gives more holders
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!accounts.length) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const a of accounts) await putUse(a, usersFor(chosen[a.id] ?? choiceOf(a.use!), a, meta));
      onSaved({ tone: "good", text: t("set.acuse.saved") });
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" id="tilien-kayttajat">
      <div className="card-head">
        <div>
          <h2>{t("set.acuse.account_users")}</h2>
          <div className="card-sub">{t("set.acuse.the_users_inferred_from_the")}</div>
        </div>
      </div>
      <ul className="acc-pick">
        {accounts.map((a) => (
          <li key={a.id}>
            <div className="acc-pick-name">
              <strong>{a.name}</strong>
              <div className="acc-pick-line">{[accountNumber(a), a.holder].filter(Boolean).join(" · ")}</div>
            </div>
            <ChoiceSelect value={chosen[a.id] ?? choiceOf(a.use!)} account={a} meta={meta} onPick={(choice) => setChosen({ ...chosen, [a.id]: choice })} />
          </li>
        ))}
      </ul>
      <div className="form-row">
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          {busy ? t("set.acuse.saving") : t("set.acuse.save")}
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
