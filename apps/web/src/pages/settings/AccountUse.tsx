/**
 * Asetukset > Tilit: who uses each account. `UseSelect` is the choice in a row (it saves at once, as the type does), `UseParts`
 * sits in a row under it for a joint account's split, its offer and questions and for a user who cannot see the account, and `LinkQuestion` asks about
 * the joint accounts a consent just brought. What each choice sends is account-use.ts; the server keeps the use (routes/finance.ts).
 */
import { useState } from "react";
import { api } from "../../api.ts";
import { accountNumber, money } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { partAnchor } from "../../part.ts";
import type { Account, AccountQuestion, Meta } from "../../types.ts";
import {
  answerCall,
  answerLabel,
  type Call,
  choiceOf,
  fieldsChanged,
  isJoint,
  JOINT,
  keyOf,
  offerText,
  openQuestions,
  optionsOf,
  ownerOf,
  ownersOf,
  peopleOf,
  percentFieldsOf,
  questionLabel,
  questionOf,
  readPercents,
  restText,
  type Said,
  type Split,
  splitOf,
  takeBackCall,
  usersFor,
} from "./account-use.ts";

type Choices = Pick<Meta, "user" | "members">;

const accountUrl = (account: Pick<Account, "id">, part: string) => `/api/accounts/${encodeURIComponent(account.id)}/${part}`;
const useUrl = (account: Pick<Account, "id">) => accountUrl(account, "use");
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

/** The members the use names who cannot see the account (GET .../use/suggestion). */
interface Suggestion {
  unseen: string[];
}

/** The labels of the three buttons of a joint account, in the order they are drawn. */
const SPLITS: { split: Split; label: string }[] = [
  { split: "source", label: "Sen mukaan, kuka tilille on maksanut" },
  { split: "equal", label: "Tasan" },
  { split: "percent", label: "Prosentit" },
];

/**
 * The row under an account that is a joint account or names another member: the choice of three for a joint account (who
 * paid, equal, percents) with the offer and the questions of the money trace, and a line with the share for each named member
 * who cannot see the account. Rendered with a key that changes with the use and the shares, so it starts from what is saved.
 */
export function UseParts({ account, meta, onSaved, onChange, onError }: { account: Account; meta: Meta; onSaved: () => void; onChange: () => void; onError: (text: string) => void }) {
  const use = account.use!;
  const people = peopleOf(account, meta);
  const owners = ownersOf(account, meta);
  const chosen = splitOf(use);
  // the fields are open while "Prosentit" is pressed, also when the account is cut otherwise until another button is
  const [open, setOpen] = useState(chosen === "percent");
  const [initial] = useState(() => percentFieldsOf(people, use));
  const [fields, setFields] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // what is on its way: a button of the choice, a question, an answer taken back, the fields
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
  const choose = (split: Split) => {
    if (split === "percent") {
      setOpen(true);
      return;
    }
    setOpen(false);
    if (split === chosen) return;
    if (split === "source") void act(split, putSource);
    else void act(split, () => putUse(account, usersFor(JOINT, account, meta)));
  };
  const read = readPercents(people, fields);
  const changed = fieldsChanged(people, fields, initial);
  const problem = "problem" in read ? read.problem : null;
  const savePercents = () => {
    if ("users" in read) void act("percent", () => putUse(account, read.users));
  };
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

  const pressed: Split = open ? "percent" : chosen;
  const questions = openQuestions(account);
  const answers = account.answers ?? [];
  return (
    <div className="use-parts" id={partAnchor(account.id)}>
      {isJoint(use) && (
        <>
          <div className="segmented" role="group" aria-label={`Tilin ${account.name} osuudet`}>
            {SPLITS.map((s) => (
              <button key={s.split} type="button" aria-pressed={pressed === s.split} disabled={busy !== null} aria-busy={busy === s.split || undefined} onClick={() => choose(s.split)}>
                {s.label}
              </button>
            ))}
          </div>
          {pressed === "percent" && (
            <form
              className="use-fields"
              onSubmit={(e) => {
                e.preventDefault();
                savePercents();
              }}
            >
              {people.map((p, i) => {
                const last = i === people.length - 1;
                const key = keyOf(p.userId);
                return (
                  <label key={key} className="use-field">
                    <span className="field-label">{p.label} %</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      readOnly={last}
                      aria-invalid={(changed && problem === key) || undefined}
                      value={last ? restText(people, fields) : (fields[key] ?? "")}
                      onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                    />
                  </label>
                );
              })}
              <button className="btn btn-primary" type="submit" disabled={busy !== null || !changed || problem !== null} aria-busy={busy === "percent" || undefined}>
                Tallenna
              </button>
            </form>
          )}
          {account.offer && (
            <ul className="use-list">
              <li className="use-row">
                <span className="use-label">Tilille maksettu</span>
                <span className="use-sum">{offerText(account.offer, people)}</span>
                <span className="use-actions">
                  <button className="btn btn-small" type="button" disabled={busy !== null} aria-busy={busy === "offer" || undefined} onClick={() => void act("offer", putSource)}>
                    Käytä tätä
                  </button>
                </span>
              </li>
            </ul>
          )}
          {questions.length > 0 && (
            <>
              <h3 className="use-head">Kenen rahaa?</h3>
              <ul className="use-list">
                {questions.map((q) => (
                  <li key={`${q.kind}:${q.key}`} className="use-row">
                    <span className="use-label">{questionLabel(q)}</span>
                    <span className="use-sum">{money(q.openCents)}</span>
                    <span className="use-actions">
                      {owners.map((o) => (
                        <button key={keyOf(o.userId)} className="btn btn-small" type="button" disabled={busy !== null} aria-busy={working(q) || undefined} aria-label={`${o.label}: ${questionLabel(q)}`} onClick={() => send(answerCall(account.id, q, ownerOf(o.userId)))}>
                          {o.label}
                        </button>
                      ))}
                      {(["all", "none"] as const).map((owner) => (
                        <button key={owner} className="btn btn-small" type="button" disabled={busy !== null} aria-busy={working(q) || undefined} aria-label={`${answerLabel(owner, owners)}: ${questionLabel(q)}`} onClick={() => send(answerCall(account.id, q, owner))}>
                          {answerLabel(owner, owners)}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {answers.length > 0 && (
            <>
              <h3 className="use-head">Vastaukset</h3>
              <ul className="use-list">
                {answers.map((a) => (
                  <li key={`${a.kind}:${a.key}`} className="use-row">
                    <span className="use-label">{questionLabel(a)}</span>
                    <span className="use-sum">{answerLabel(a.owner, owners)}</span>
                    <span className="use-actions">
                      <button className="btn btn-small" type="button" disabled={busy !== null} aria-busy={working(a) || undefined} aria-label={`Poista: ${questionLabel(a)}`} onClick={() => send(takeBackCall(account.id, a))}>
                        Poista
                      </button>
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
        <button className="btn btn-primary" type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void save()}>
          {busy ? "Tallennetaan…" : "Tallenna"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
