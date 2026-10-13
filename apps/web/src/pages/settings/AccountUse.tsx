/**
 * Asetukset > Tilit: who uses each account. `UseSelect` is the choice in a row (it saves at once, as the type does), `UseParts`
 * sits in a row under it for a joint account's parts and for a user who cannot see the account, and `LinkQuestion` asks about
 * the joint accounts a consent just brought. What each choice sends is account-use.ts; the server keeps the use (routes/finance.ts).
 */
import { useState } from "react";
import { api } from "../../api.ts";
import { accountNumber } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { Account, Meta } from "../../types.ts";
import { choiceOf, fieldsOf, isEqual, isJoint, JOINT, keyOf, optionsOf, peopleOf, proposalText, questionOf, readFields, type Said, sameShares, sharesText, usersFor } from "./account-use.ts";

type Choices = Pick<Meta, "user" | "members">;

const useUrl = (account: Pick<Account, "id">) => `/api/accounts/${encodeURIComponent(account.id)}/use`;
const putUse = (account: Pick<Account, "id">, users: Said[]) => api(useUrl(account), { method: "PUT", body: { users } });

/** The select with a name for the account it belongs to; the choices are the options of account-use.ts. */
function ChoiceSelect({ value, account, meta, onPick }: { value: string; account: Account; meta: Choices; onPick: (choice: string) => void }) {
  return (
    <select value={value} aria-label={`Tilin ${account.name} käyttäjä`} onChange={(e) => onPick(e.target.value)}>
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
  if (options.length < 2) return <>Minä</>;
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
          Tallennettu.
        </div>
      )}
      {use.source === "said" && (
        <div className="small">
          <button className="text-button" type="button" onClick={() => void run(() => api(useUrl(account), { method: "DELETE" }))}>
            Palauta pankin tiedoista
          </button>
        </div>
      )}
    </>
  );
}

/** What the server proposes for the account's parts, and the named members who cannot see the account (GET .../use/suggestion). */
interface Suggestion {
  weights: Said[] | null;
  unseen: string[];
}

/**
 * The row under an account that is a joint account or names another member: the parts ("Tasan" or "Omat osuudet" with a field
 * for each user), the proposal of the bank's rows, and a line with the share for each named member who cannot see the account.
 * Rendered with a key that changes with the use and the shares, so it asks again and starts from what is saved.
 */
export function UseParts({ account, meta, onSaved, onChange, onError }: { account: Account; meta: Meta; onSaved: () => void; onChange: () => void; onError: (text: string) => void }) {
  const use = account.use!;
  const people = peopleOf(account, meta);
  const [own, setOwn] = useState(!isEqual(use));
  const [fields, setFields] = useState(() => fieldsOf(people, use));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data } = useApi<Suggestion>(`${useUrl(account)}/suggestion`);

  const save = async (users: Said[]) => {
    setBusy(true);
    setError(null);
    try {
      await putUse(account, users);
      onSaved();
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveFields = () => {
    const read = readFields(people, fields);
    if ("problem" in read) setError(read.problem);
    else void save(read.users);
  };
  const share = async (userId: string) => {
    try {
      await api(`/api/accounts/${encodeURIComponent(account.id)}/shares/${encodeURIComponent(userId)}`, { method: "PUT" });
      onChange();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const typed = people.map((p) => {
    const read = readFields([p], fields);
    return "users" in read ? read.users[0]!.weight : 0;
  });
  const proposal = data?.weights && !sameShares(data.weights, use.users) ? data.weights : null;
  return (
    <div className="use-parts">
      {isJoint(use) && (
        <>
          <div className="segmented" role="group" aria-label={`Tilin ${account.name} osuudet`}>
            <button type="button" aria-pressed={!own} disabled={busy} onClick={() => (isEqual(use) ? setOwn(false) : void save(usersFor(JOINT, account, meta)))}>
              Tasan
            </button>
            <button type="button" aria-pressed={own} onClick={() => setOwn(true)}>
              Omat osuudet
            </button>
          </div>
          {own && (
            <form
              className="use-fields"
              onSubmit={(e) => {
                e.preventDefault();
                saveFields();
              }}
            >
              {people.map((p) => (
                <label key={keyOf(p.userId)} className="use-field">
                  <span className="field-label">{p.label}</span>
                  <span className="use-input">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${p.label} € kuussa`}
                      value={fields[keyOf(p.userId)] ?? ""}
                      onChange={(e) => setFields({ ...fields, [keyOf(p.userId)]: e.target.value })}
                    />
                    <span className="muted">€ kuussa</span>
                  </span>
                </label>
              ))}
              <span className="use-total" role="status">
                {sharesText(typed)}
              </span>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                Tallenna
              </button>
              <div className="field-help use-help">Jako sen mukaan, paljonko kukin maksaa tilille.</div>
            </form>
          )}
          {proposal && (
            <div className="use-line small">
              <span>Viime kuukausina {proposalText(proposal, people)} kuussa.</span>
              <button className="btn btn-small" type="button" disabled={busy} onClick={() => void save(proposal.filter((w) => w.weight > 0))}>
                Käytä näitä
              </button>
            </div>
          )}
        </>
      )}
      {data?.unseen.map((id) => (
        <div key={id} className="use-line small" role="status">
          <span>{meta.members.find((m) => m.id === id)?.displayName ?? "Käyttäjä"} ei näe tätä tiliä, joten osuus ei näy hänen luvuissaan.</span>
          <button className="btn btn-small" type="button" onClick={() => void share(id)}>
            Jaa tili
          </button>
        </div>
      ))}
      {error && <div className="error">{error}</div>}
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
      onSaved({ tone: "good", text: "Tallennettu." });
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
          <h2>Tilien käyttäjät</h2>
          <div className="card-sub">Valittuna ovat pankin tiedoista päätellyt käyttäjät.</div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="ruled">
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.name}
                  <div className="sub acc-line">{[accountNumber(a), a.holder].filter(Boolean).join(" · ")}</div>
                </td>
                <td>
                  <ChoiceSelect value={chosen[a.id] ?? choiceOf(a.use!)} account={a} meta={meta} onPick={(choice) => setChosen({ ...chosen, [a.id]: choice })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-row">
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "Tallennetaan…" : "Tallenna"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
