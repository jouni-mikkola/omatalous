/**
 * Asetukset > Tilit, under a shared account or card: "Jako", the agreement in force on how the account's shared costs
 * are cut between its users, the earlier ones, and a form that adds one from a day. The server keeps a dated row per
 * day and refuses a day that has one (routes/settlement.ts); a user it does not weigh in the account gets no answer, so no row.
 */
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { date, money, parseEuros } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { Account } from "../../types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { labelTable, t } from "../../text.ts";
type Kind = "equal" | "share" | "income" | "fixed";
interface Row {
  validFrom: string;
  kind: Kind;
  value: { who?: string[]; weights?: Record<string, number>; cents?: Record<string, number>; rest?: { kind: Exclude<Kind, "fixed"> } };
  setAt: string;
  /** A row that is not in force yet: who has put it and who is waited for; `mayRemove` is what this user may do with it. */
  pending?: { confirmed: string[]; waiting: string[]; mayRemove: "decline" | "withdraw" | null };
}
interface Answer {
  accountId: string;
  users: { owner: string; name: string }[];
  /** Household members named by a row who are gone. */
  removed: string[];
  agreements: Row[];
}

const KIND_LABEL: Record<Kind, string> = labelTable({ equal: () => t("set.split.equally"), share: () => t("set.split.by_shares"), income: () => t("set.split.in_proportion_to_income"), fixed: () => t("set.split.fixed_amount") });
const REST_KINDS = ["equal", "income"] as const;

/** The values of one agreement as a line: the names with their parts. */
export function valuesOf(row: Row, name: (owner: string) => string): string {
  if (row.kind === "share") {
    const weights = Object.entries(row.value.weights ?? {});
    const sum = weights.reduce((s, [, w]) => s + w, 0) || 1;
    return weights.map(([o, w]) => `${name(o)} ${Math.round((w / sum) * 100)} %`).join(" · ");
  }
  if (row.kind === "fixed") {
    const fixed = Object.entries(row.value.cents ?? {}).map(([o, c]) => `${name(o)} ${money(c)}`);
    return [...fixed, row.value.rest ? t("set.split.rest", { kind: KIND_LABEL[row.value.rest.kind].toLowerCase() }) : t("set.split.the_split_of_the_rest")].join(" · ");
  }
  return (row.value.who ?? []).map(name).join(" · ");
}

/** The agreement row in force on `today`: the latest that began by then. */
const inForce = (rows: readonly Row[], today: string): Row | undefined => [...rows].filter((r) => r.validFrom <= today && !r.pending).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];

export function AccountSplit({ account, today }: { account: Account; today: string }) {
  const { data, reload } = useApi<Answer>(`/api/settlement/agreements/${encodeURIComponent(account.id)}`);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const names = Object.fromEntries(data.users.map((u) => [u.owner, u.name]));
  const name = (owner: string) => names[owner] ?? (data.removed.includes(owner) ? t("set.split.removed_member") : owner);
  const current = inForce(data.agreements, today);
  const waiting = data.agreements.filter((r) => r.pending);
  const earlier = [...data.agreements].filter((r) => r !== current && !r.pending).sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const card = account.type === "credit_card";
  // the answer to a row that waits: the same row put again is a yes, taking it back is a no; the server lets each user only their own
  const answer = async (row: Row, yes: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const path = `/api/settlement/agreements/${encodeURIComponent(account.id)}`;
      if (yes) await api(path, { method: "PUT", body: { validFrom: row.validFrom, kind: row.kind, value: row.value } });
      else await api(`${path}/${row.validFrom}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const waits = (row: Row) => (
    <li key={`wait-${row.validFrom}`} className="use-row">
      <span className="use-label">
        {KIND_LABEL[row.kind]}
        <div className="sub">{t("set.split.awaiting", { names: row.pending!.waiting.map(name).join(", ") })}</div>
      </span>
      <span className="use-sum">{date(row.validFrom)}</span>
      {row.pending!.mayRemove === "decline" && (
        <>
          <Button variant="primary" busy={busy} onClick={() => void answer(row, true)}>
            {t("set.split.approve")}
          </Button>
          <Button busy={busy} onClick={() => void answer(row, false)}>
            {t("set.split.reject")}
          </Button>
        </>
      )}
      {row.pending!.mayRemove === "withdraw" && (
        <Button variant="link" busy={busy} onClick={() => void answer(row, false)}>
          {t("set.split.cancel_the_proposal")}
        </Button>
      )}
    </li>
  );
  const line = (row: Row) => (
    <li key={row.validFrom} className="use-row">
      <span className="use-label">
        {KIND_LABEL[row.kind]}
        <div className="sub">{valuesOf(row, name)}</div>
      </span>
      <span className="use-sum">{date(row.validFrom)}</span>
    </li>
  );
  return (
    <tr className="edit-row">
      <td colSpan={5}>
    <div className="use-parts" role="group" aria-label={t("set.split.split_of_account_name", { name: account.name })}>
      <h3 className="use-head">{t("set.split.split")}</h3>
      <ul className="use-list">
        {current ? line(current) : (
          // with no row the account's own shares (Osuudet in its use) cut the costs: core's rule for an account without an agreement
          <li className="use-row">
            <span className="use-label">{t("set.split.no_split_has_been_agreed")}</span>
          </li>
        )}
        {waiting.map(waits)}
      </ul>
      {error && <Notice tone="error">{error}</Notice>}
      {earlier.length > 0 && <ul className="use-list" aria-label={t("set.split.earlier_splits")}>{earlier.map(line)}</ul>}
      {open ? (
        <SplitForm
          key={data.agreements.length}
          account={account}
          users={data.users}
          card={card}
          today={today}
          onCancel={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            reload();
          }}
        />
      ) : (
        <Button variant="link" onClick={() => setOpen(true)}>
          {t("set.split.change_the_split")}
        </Button>
      )}
    </div>
      </td>
    </tr>
  );
}

function SplitForm({ account, users, card, today, onCancel, onSaved }: { account: Account; users: Answer["users"]; card: boolean; today: string; onCancel: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<Kind>("equal");
  const [who, setWho] = useState<string[]>(users.map((u) => u.owner));
  // the figure of each user: parts for "Osuuksien mukaan", euros for "Kiinteä summa" (empty: not listed)
  const [fields, setFields] = useState<Record<string, string>>({});
  const [rest, setRest] = useState<(typeof REST_KINDS)[number] | "">("");
  const [from, setFrom] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = (): { value: unknown } | { problem: string } => {
    if (kind === "equal" || kind === "income") return who.length ? { value: { who } } : { problem: t("set.split.choose_at_least_one_user") };
    if (kind === "share") {
      const weights: Record<string, number> = {};
      for (const u of users) {
        const w = Number((fields[u.owner] ?? "").replace(",", "."));
        if (!Number.isInteger(w) || w < 0) return { problem: t("set.split.enter_the_shares_as_whole") };
        if (w > 0) weights[u.owner] = w;
      }
      return Object.keys(weights).length ? { value: { weights } } : { problem: t("set.split.enter_the_shares_as_whole") };
    }
    if (!rest) return { problem: t("set.split.choose_how_the_rest_is") };
    const cents: Record<string, number> = {};
    for (const u of users) {
      const text = (fields[u.owner] ?? "").trim();
      if (!text) continue;
      const c = parseEuros(text);
      if (c === null || c <= 0) return { problem: t("set.split.enter_the_amount_in_euros") };
      cents[u.owner] = c;
    }
    return Object.keys(cents).length ? { value: { cents, rest: { kind: rest } } } : { problem: t("set.split.enter_the_amount_in_euros") };
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const built = build();
    if ("problem" in built) return setError(built.problem);
    setBusy(true);
    setError(null);
    try {
      await api(`/api/settlement/agreements/${encodeURIComponent(account.id)}`, { method: "PUT", body: { validFrom: from, kind, value: built.value } });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const kinds = (Object.keys(KIND_LABEL) as Kind[]).filter((k) => !(card && k === "fixed"));
  return (
    <form className="use-fields" onSubmit={(e) => void save(e)} aria-label={t("set.split.change_the_split_of_account", { name: account.name })}>
      <label className="use-field">
        <span className="field-label">{t("set.split.how_to_split")}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {(kind === "equal" || kind === "income") &&
        users.map((u) => (
          <label key={u.owner} className="use-check">
            <input type="checkbox" checked={who.includes(u.owner)} onChange={(e) => setWho(e.target.checked ? [...who, u.owner] : who.filter((o) => o !== u.owner))} />
            <span>{u.name}</span>
          </label>
        ))}
      {(kind === "share" || kind === "fixed") &&
        users.map((u) => (
          <label key={u.owner} className="use-field">
            <span className="field-label">{kind === "share" ? `${u.name} osuus` : `${u.name} €`}</span>
            <input type="text" inputMode="decimal" value={fields[u.owner] ?? ""} onChange={(e) => setFields({ ...fields, [u.owner]: e.target.value })} placeholder={kind === "fixed" ? "300,00" : "50"} />
          </label>
        ))}
      {kind === "fixed" && (
        <label className="use-field">
          <span className="field-label">{t("set.split.the_rest_is_shared")}</span>
          <select value={rest} onChange={(e) => setRest(e.target.value as (typeof REST_KINDS)[number] | "")}>
            <option value="">{t("set.split.choose")}</option>
            {REST_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="use-field use-field-date">
        <span className="field-label">{t("set.split.in_force_from")}</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
      </label>
      <Button variant="primary" type="submit" busy={busy}>
        {t("set.split.save")}
      </Button>
      <Button onClick={onCancel}>
        {t("set.split.cancel")}
      </Button>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}
