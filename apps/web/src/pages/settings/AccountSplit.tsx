/**
 * Asetukset > Tilit, in the row under a joint account or card: its split, one control. "Jakotapa" offers the three ways
 * of the account's use (who paid in, equal, by shares: account-use.ts, PUT .../use and .../split) and, to a user the
 * account weighs, the two only an agreement says (by income, a fixed sum: a dated row, routes/settlement.ts). The pressed
 * way is what cuts the costs now: the agreement in force, else the use, so the control never names one way while another
 * cuts the costs. With no agreement in force who paid and Tasan are saved as the use at once, as before, and the shares
 * are the use too unless a day is typed, which makes them an agreement from that day and leaves the closed months be.
 * While one is in force every way is a new agreement from a day and who paid is not offered, as no agreement says it.
 * An income agreement waits for the users it names (agreement-pending.ts); the rows that wait and the earlier ones are
 * listed under the control.
 */
import { type FormEvent, type ReactNode, useState } from "react";
import { api } from "../../api.ts";
import { date, money, parseEuros } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { Account, Meta } from "../../types.ts";
import { fieldsChanged, JOINT, keyOf, ownerOf, peopleOf, percentFieldsOf, readPercents, restText, type Said, type Split, splitOf, usersFor } from "./account-use.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
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
/** What a new agreement sends. */
type Agreement = Pick<Row, "kind" | "value">;

/** A way of the control: the use's three and the two only an agreement says. */
export type Way = Split | "income" | "fixed";

const KIND_LABEL: Record<Kind, string> = labelTable({ equal: () => t("set.split.equally"), share: () => t("set.split.by_shares"), income: () => t("set.split.in_proportion_to_income"), fixed: () => t("set.split.fixed_amount") });
const WAY_LABEL: Record<Way, string> = labelTable({
  source: () => t("set.acuse.by_who_has_paid_into"),
  equal: () => t("set.split.equally"),
  percent: () => t("set.split.by_shares"),
  income: () => t("set.split.in_proportion_to_income"),
  fixed: () => t("set.split.fixed_amount"),
});
const REST_KINDS = ["equal", "income"] as const;

/** The way an agreement is: a share agreement is Osuuksien mukaan, as the percents of the use are. */
export const wayOf = (kind: Kind): Way => (kind === "share" ? "percent" : kind);

/**
 * The ways the control offers, in order: the use's three, and the agreement's two to a user the account weighs (a card
 * has no fixed sum). Who paid is not offered while an agreement is in force: no agreement says it.
 */
export const waysFor = (agrees: boolean, card: boolean, agreed: boolean): Way[] => [
  ...(agreed ? [] : ["source" as const]),
  "equal",
  "percent",
  ...(agrees ? (card ? ["income" as const] : ["income" as const, "fixed" as const]) : []),
];

/** Tasan or the shares as an agreement from a day: Tasan between everyone the use names, or the typed percents. */
export function agreementOfUse(way: "equal" | "percent", users: readonly Said[]): Agreement {
  const named = users.filter((u) => u.weight > 0);
  if (way === "equal") return { kind: "equal", value: { who: named.map((u) => ownerOf(u.userId)) } };
  return { kind: "share", value: { weights: Object.fromEntries(named.map((u) => [ownerOf(u.userId), u.weight])) } };
}

/** The values of one agreement as a line: the names with their parts. */
export function valuesOf(row: Pick<Row, "kind" | "value">, name: (owner: string) => string): string {
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

export function AccountSplit({ account, meta, onSaved, onChange }: { account: Account; meta: Meta; onSaved: () => void; onChange: () => void }) {
  const use = account.use!;
  const card = account.type === "credit_card";
  // the server answers the agreements only to a user the account weighs (services/settlement.ts)
  const agrees = use.users.some((u) => u.userId === meta.user.id && u.weight > 0);
  const path = `/api/settlement/agreements/${encodeURIComponent(account.id)}`;
  const { data, error: unread, reload } = useApi<Answer>(agrees ? path : null);
  const people = peopleOf(account, meta);
  const [initial] = useState(() => percentFieldsOf(people, use));
  const [fields, setFields] = useState(initial);
  // the way whose fields are open; with no agreement in force Osuuksien mukaan has its fields open while it is pressed
  const [open, setOpen] = useState<Way | null>(null);
  // the day a new agreement starts; empty only for the shares with no agreement in force, which are then the use
  const [from, setFrom] = useState("");
  // what is on its way: a way, an answer to a row that waits
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groupName = t("set.split.split_of_account_name", { name: account.name });
  // until the agreements are read no way is pressed: the use's may not be the one that cuts the costs
  if (agrees && !data && !unread)
    return (
      <div className="use-split" role="group" aria-label={groupName} aria-busy="true">
        <h3 className="use-head">{t("set.split.split")}</h3>
      </div>
    );

  const rows = data?.agreements ?? [];
  const current = inForce(rows, meta.today);
  const now: Way = current ? wayOf(current.kind) : splitOf(use);
  const pressed: Way = open ?? now;
  const names = Object.fromEntries((data?.users ?? []).map((u) => [u.owner, u.name]));
  const name = (owner: string) => names[owner] ?? (data?.removed.includes(owner) ? t("set.split.removed_member") : owner);
  const waiting = rows.filter((r) => r.pending);
  const earlier = rows.filter((r) => r !== current && !r.pending).sort((a, b) => b.validFrom.localeCompare(a.validFrom));

  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
      setOpen(null);
      reload();
      onSaved();
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const putUse = (users: Said[]) => api(`/api/accounts/${encodeURIComponent(account.id)}/use`, { method: "PUT", body: { users } });
  const putSource = () => api(`/api/accounts/${encodeURIComponent(account.id)}/split`, { method: "PUT", body: { mode: "source" } });
  const putAgreement = (a: Agreement) => api(path, { method: "PUT", body: { validFrom: from, kind: a.kind, value: a.value } });
  /** A way of the use said: from a day an agreement (the use stays for the months before), with no day the use. */
  const sayUse = (way: Split, users: Said[]) => act(way, () => (from && way !== "source" ? putAgreement(agreementOfUse(way, users)) : way === "source" ? putSource() : putUse(users)));

  const choose = (way: Way) => {
    setError(null);
    setFrom(current || way === "income" || way === "fixed" ? meta.today : "");
    if (way === "percent") {
      // the fields start from the shares that cut the costs now: the agreement's when it is one of shares, else the use's
      const weights = current?.kind === "share" ? current.value.weights : undefined;
      setFields(weights ? percentFieldsOf(people, { ...use, users: use.users.map((u) => ({ ...u, weight: weights[ownerOf(u.userId)] ?? 0 })) }) : initial);
    }
    if (current || way === "percent" || way === "income" || way === "fixed") return setOpen(way === now && !current && way === "percent" ? null : way);
    setOpen(null);
    if (way !== now) void sayUse(way, usersFor(JOINT, account, meta));
  };

  // a row that waits is answered by putting the same row again (yes) or taking it back (no); the server lets each user only their own
  const answer = (row: Row, yes: boolean) =>
    act(`${row.validFrom}`, () => (yes ? api(path, { method: "PUT", body: { validFrom: row.validFrom, kind: row.kind, value: row.value } }) : api(`${path}/${row.validFrom}`, { method: "DELETE" })));
  const waits = (row: Row) => (
    <li key={`wait-${row.validFrom}`} className="use-row">
      <span className="use-label">
        {KIND_LABEL[row.kind]}
        <div className="sub">{t("set.split.awaiting", { names: row.pending!.waiting.map(name).join(", ") })}</div>
      </span>
      <span className="use-sum">{date(row.validFrom)}</span>
      {row.pending!.mayRemove === "decline" && (
        <>
          <Button variant="primary" busy={busy === row.validFrom} disabled={busy !== null} onClick={() => void answer(row, true)}>
            {t("set.split.approve")}
          </Button>
          <Button busy={busy === row.validFrom} disabled={busy !== null} onClick={() => void answer(row, false)}>
            {t("set.split.reject")}
          </Button>
        </>
      )}
      {row.pending!.mayRemove === "withdraw" && (
        <Button variant="link" busy={busy === row.validFrom} disabled={busy !== null} onClick={() => void answer(row, false)}>
          {t("set.split.cancel_the_proposal")}
        </Button>
      )}
    </li>
  );
  const line = (row: Row) => (
    <li key={row.validFrom} className="use-row">
      <span className="use-label">{valuesOf(row, name)}</span>
      <span className="use-sum">{date(row.validFrom)}</span>
    </li>
  );

  const read = readPercents(people, fields);
  const problem = "problem" in read ? read.problem : null;
  const changed = fieldsChanged(people, fields, initial);
  const formName = t("set.split.change_the_split_of_account", { name: account.name });
  // a day is asked of every new agreement; the shares with no agreement in force may go without one, as the use
  const optional = !current && open !== "income" && open !== "fixed";
  const hint = `${account.id}-no-day`;
  const day = (
    <div className="use-field use-field-date">
      <label className="use-field">
        <span className="field-label">{t("set.split.in_force_from")}</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required={!optional} aria-describedby={optional ? hint : undefined} />
      </label>
      {optional && (
        <span className="sub" id={hint}>
          {t("set.split.no_day_every_month")}
        </span>
      )}
    </div>
  );
  const cancel = (
    <Button
      disabled={busy !== null}
      onClick={() => {
        setOpen(null);
        setError(null);
      }}
    >
      {t("set.split.cancel")}
    </Button>
  );
  // the server's refusal stands in the fields that were sent, else under the control
  const percentOpen = pressed === "percent" && (current ? open === "percent" : true);
  const useOpen = !!current && open === "equal";
  const agreementOpen = !!data && (open === "income" || open === "fixed");
  const refusal = error ? <Notice tone="error">{error}</Notice> : null;
  return (
    <div className="use-split" role="group" aria-label={groupName}>
      <h3 className="use-head">{t("set.split.split")}</h3>
      <Segmented
        label={t("set.split.how_to_split")}
        value={pressed}
        options={waysFor(agrees, card, !!current).map((w) => ({ value: w, label: WAY_LABEL[w], disabled: busy !== null }))}
        busy={busy !== null && busy in WAY_LABEL ? (busy as Way) : null}
        onChange={choose}
      />
      {percentOpen && (
        <form
          className="use-fields"
          aria-label={formName}
          onSubmit={(e) => {
            e.preventDefault();
            if ("users" in read) void sayUse("percent", read.users);
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
          {agrees && day}
          <Button variant="primary" type="submit" disabled={busy !== null || (!current && !changed && !from) || problem !== null} aria-busy={busy === "percent" || undefined}>
            {t("set.split.save")}
          </Button>
          {current && cancel}
          {refusal}
        </form>
      )}
      {useOpen && (
        <form
          className="use-fields"
          aria-label={formName}
          onSubmit={(e) => {
            e.preventDefault();
            void sayUse("equal", usersFor(JOINT, account, meta));
          }}
        >
          {day}
          <Button variant="primary" type="submit" disabled={busy !== null} aria-busy={busy === open || undefined}>
            {t("set.split.save")}
          </Button>
          {cancel}
          {refusal}
        </form>
      )}
      {agreementOpen && <AgreementForm key={open} kind={open as "income" | "fixed"} name={formName} users={data.users} day={day} cancel={cancel} refusal={refusal} busy={busy !== null} onSave={(a) => act(open!, () => putAgreement(a))} />}
      {(current || waiting.length > 0) && (
        <ul className="use-list">
          {current && line(current)}
          {waiting.map(waits)}
        </ul>
      )}
      {earlier.length > 0 && (
        <ul className="use-list" aria-label={t("set.split.earlier_splits")}>
          {earlier.map(line)}
        </ul>
      )}
      {!percentOpen && !useOpen && !agreementOpen && refusal}
    </div>
  );
}

/** The fields of the two ways only an agreement says: who by income, or each user's fixed sum and how the rest is cut. */
function AgreementForm({ kind, name, users, day, cancel, refusal, busy, onSave }: { kind: "income" | "fixed"; name: string; users: Answer["users"]; day: ReactNode; cancel: ReactNode; refusal: ReactNode; busy: boolean; onSave: (a: Agreement) => Promise<void> }) {
  const [who, setWho] = useState<string[]>(users.map((u) => u.owner));
  // euros of each user (empty: not listed)
  const [fields, setFields] = useState<Record<string, string>>({});
  const [rest, setRest] = useState<(typeof REST_KINDS)[number] | "">("");
  const [problem, setProblem] = useState<string | null>(null);

  const build = (): Agreement | { problem: string } => {
    if (kind === "income") return who.length ? { kind, value: { who } } : { problem: t("set.split.choose_at_least_one_user") };
    if (!rest) return { problem: t("set.split.choose_how_the_rest_is") };
    const cents: Record<string, number> = {};
    for (const u of users) {
      const text = (fields[u.owner] ?? "").trim();
      if (!text) continue;
      const c = parseEuros(text);
      if (c === null || c <= 0) return { problem: t("set.split.enter_the_amount_in_euros") };
      cents[u.owner] = c;
    }
    return Object.keys(cents).length ? { kind, value: { cents, rest: { kind: rest } } } : { problem: t("set.split.enter_the_amount_in_euros") };
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const built = build();
    if ("problem" in built) return setProblem(built.problem);
    setProblem(null);
    void onSave(built);
  };

  return (
    <form className="use-fields" onSubmit={save} aria-label={name}>
      {kind === "income" &&
        users.map((u) => (
          <label key={u.owner} className="use-check">
            <input type="checkbox" checked={who.includes(u.owner)} onChange={(e) => setWho(e.target.checked ? [...who, u.owner] : who.filter((o) => o !== u.owner))} />
            <span>{u.name}</span>
          </label>
        ))}
      {kind === "fixed" &&
        users.map((u) => (
          <label key={u.owner} className="use-field">
            <span className="field-label">{`${u.name} €`}</span>
            <input type="text" inputMode="decimal" value={fields[u.owner] ?? ""} onChange={(e) => setFields({ ...fields, [u.owner]: e.target.value })} placeholder="300,00" />
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
      {day}
      <Button variant="primary" type="submit" busy={busy}>
        {t("set.split.save")}
      </Button>
      {cancel}
      {problem ? <Notice tone="error">{problem}</Notice> : refusal}
    </form>
  );
}
