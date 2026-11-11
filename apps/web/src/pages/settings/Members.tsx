/**
 * Household members (admin): add, reset password, remove. A member can be added without a login: a name for a person
 * who shares an account but never signs in (with or without a bank holder name; a holder line that names them counts
 * for that person in Raportit > Yhteiset menot, the server matches the names). Those people are rows of the same table.
 */
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import { copyText } from "../../clipboard.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Table } from "../../components/table/Table.tsx";
import { date } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { InstanceState, Meta, User } from "../../types.ts";
import { addressToSave } from "../Wizard.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { rich, t } from "../../text.ts";
/** What a new member needs to log in: the address, the username, the temporary password and that it must change. */
export function memberInstructions(address: string, username: string, password: string): string {
  return [
    t("set.mem.instr_app", { address }),
    t("set.mem.instr_username", { username }),
    t("set.mem.instr_password", { password }),
    t("set.mem.change_the_password_at_the"),
  ].join("\n");
}

/** The temporary password, shown once, with a button that copies the whole instruction for the member. */
export function SecretBox({ who, password, address }: { who: string; password: string; address: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const onCopy = async () => {
    setState((await copyText(memberInstructions(address, who, password))) ? "copied" : "failed");
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <div className="secret-box" role="status">
      {rich("set.mem.temp_password_for", {}, { who: <strong>{who}</strong>, password: <code>{password}</code> })}
      <div className="small muted">{t("set.mem.shown_only_once")}</div>
      <Button onClick={() => void onCopy()}>
        {state === "copied" ? t("set.mem.copied") : state === "failed" ? t("set.mem.copying_failed") : t("set.mem.copy_the_instructions")}
      </Button>
    </div>
  );
}

/** A person of the household with no login (server services/settlement). */
interface Nameless {
  id?: number | string;
  name: string;
}

/** The holder names the accounts show, each once: a holder line of two names is two. */
function holdersOf(meta: Pick<Meta, "accounts">): string[] {
  const names = meta.accounts.flatMap((a) => (a.holder ?? "").split(";").map((n) => n.trim()).filter(Boolean)); // language-allow: semicolon the bank separates two holders with a semicolon
  return [...new Set(names)];
}

/** One row of the table: a member with a login, or a person without. */
type Row = { key: string; name: string; user?: User; nameless?: Nameless };

const USERNAME = /^[A-Za-z0-9._-]{3,32}$/;
const usernameHint = () => t("set.mem.3_32_characters_letters_numbers"); // language-allow: triple-list the hint must name every character the username allows

/** The day the member was added, in the instance's time zone: a member made late at night is not dated a day early. */
export const addedOn = (u: Pick<User, "createdAt">): string => date(u.createdAt);

export function Members({ me, meta, onChange, onLoaded }: { me: User; meta: Meta; onChange: () => void; onLoaded?: () => void }) {
  const { data, error: loadError, reload } = useApi<{ users: User[] }>("/api/users");
  // the page scrolls to a card below this one only after this one has its height
  const people = useApi<{ members: Nameless[] }>("/api/admin/household-members");
  const done = (data !== null || loadError !== null) && (people.data !== null || people.error !== null);
  useEffect(() => {
    if (done) onLoaded?.();
  }, [done, onLoaded]);
  // the address a member types: the one in use here, or the installer's when this is a local or tunnelled view
  const instance = useApi<InstanceState>("/api/admin/instance");
  const address = addressToSave(instance.data?.settings.appBaseUrl ?? window.location.origin, window.location.origin);
  const [form, setForm] = useState({ username: "", displayName: "", role: "member" });
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doing, setDoing] = useState("");
  const [asking, setAsking] = useState<{ act: "remove" | "reset" | "factor"; u: User } | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const [badName, setBadName] = useState(false);
  // "ilman kirjautumista": only a name is asked
  const [noLogin, setNoLogin] = useState(false);
  // the form opens by its button: a list of one member does not sit under a form it has no use for
  const [adding, setAdding] = useState(false);
  const [removingNameless, setRemovingNameless] = useState<Nameless | null>(null);
  const holders = holdersOf(meta);
  const namelessList = people.data?.members ?? [];
  const nameField = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<void>, key = "") => {
    if (busy) return;
    setBusy(true);
    setDoing(key);
    setError(null);
    try {
      await fn();
      reload();
      people.reload();
      onChange(); // member list in the edit form of an account
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addNameless = (e: FormEvent) => {
    e.preventDefault();
    const name = form.displayName.trim();
    if (!name) return;
    void run(async () => {
      await api("/api/admin/household-members", { method: "PUT", body: { members: [...namelessList, { name }] } });
      setForm({ username: "", displayName: "", role: "member" });
      setAdding(false);
    });
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (noLogin) return addNameless(e);
    if (!USERNAME.test(form.username)) {
      setError(usernameHint());
      setBadName(true);
      nameField.current?.focus();
      return;
    }
    setBadName(false);
    void run(async () => {
      const r = await api<{ user: User; temporaryPassword: string }>("/api/users", { method: "POST", body: form });
      setSecret({ who: r.user.username, password: r.temporaryPassword });
      setForm({ username: "", displayName: "", role: "member" });
      setAdding(false);
    });
  };

  const rows: Row[] = [
    ...(data?.users ?? []).map((user) => ({ key: user.id, name: user.displayName, user })),
    ...namelessList.map((nameless) => ({ key: `nameless-${nameless.id ?? nameless.name}`, name: nameless.name, nameless })),
  ];

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{t("set.mem.household_members")}</h2>
        </div>
      </div>
      {secret && <SecretBox key={`${secret.who}:${secret.password}`} who={secret.who} password={secret.password} address={address} />}
      {!adding && <Button onClick={() => setAdding(true)}>{t("set.mem.add_member")}</Button>}
      {adding && <form className="form-row form-fields" onSubmit={add} noValidate>
        {!noLogin && (
          <label className="field">
            {t("set.mem.login_name")}
            <input ref={nameField} type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required aria-invalid={badName || undefined} aria-describedby="tunnus-ohje" />
            <span className="field-hint" id="tunnus-ohje">{usernameHint()}</span>
          </label>
        )}
        <label className="field">
          {t("set.mem.name")}
          <input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={80} />
        </label>
        {noLogin && holders.length > 0 && (
          <label className="field">
            {t("set.mem.name_in_the_bank_s")}
            <select value="" onChange={(e) => e.target.value && setForm({ ...form, displayName: e.target.value })}>
              <option value="">{t("set.mem.choose")}</option>
              {holders.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        )}
        {!noLogin && (
          <label className="field">
            {t("set.mem.role")}
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="member">{t("set.mem.member")}</option>
              <option value="admin">{t("set.mem.administrator")}</option>
            </select>
          </label>
        )}
        <label className="use-check">
          <input type="checkbox" checked={noLogin} onChange={(e) => { setNoLogin(e.target.checked); setError(null); setBadName(false); }} />
          <span>{t("set.mem.without_sign_in")}</span>
        </label>
        <Button variant="primary" type="submit" busy={busy}>
          {t("set.mem.add_member")}
        </Button>
        <Button onClick={() => { setAdding(false); setError(null); setBadName(false); }}>{t("set.mem.cancel")}</Button>
      </form>}
      {(error ?? loadError ?? people.error) && <Notice tone="error">{error ?? loadError ?? people.error}</Notice>}
      {removed && <Notice tone="good" role="status">{removed}</Notice>}
      {asking?.act === "remove" && (
        <ConfirmDialog
          title={t("set.mem.remove_name", { name: asking.u.displayName })}
          confirmLabel={t("set.mem.remove_name_2", { name: asking.u.displayName })}
          busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const u = asking.u;
            setAsking(null);
            setRemoved(null);
            void run(async () => {
              const r = await api<{ revoked: number; failed: number }>(`/api/users/${u.id}`, { method: "DELETE" });
              setRemoved(
                `${t("set.mem.removed", { name: u.displayName })}${r.revoked ? ` ${t("set.mem.closed", { count: r.revoked })}` : ""}${r.failed ? ` ${t("set.mem.left_open", { count: r.failed })}` : ""}`,
              );
            });
          }}
        >
          <p>{t("set.mem.accounts_transactions_and_rules_are")}</p>
          <p>{t("set.mem.backups_lose_the_data_in")}</p>
        </ConfirmDialog>
      )}
      {asking?.act === "reset" && (
        <ConfirmDialog
          title={t("set.mem.reset_the_password_of_name", { name: asking.u.displayName })}
          confirmLabel={t("set.mem.reset_password")}
          busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const u = asking.u;
            setAsking(null);
            void run(async () => {
              const r = await api<{ temporaryPassword: string }>(`/api/users/${u.id}/reset-password`, { method: "POST" });
              setSecret({ who: u.username, password: r.temporaryPassword });
            }, `reset-${u.id}`);
          }}
        >
          <p>{t("set.mem.they_are_signed_out_of")}</p>
        </ConfirmDialog>
      )}
      {asking?.act === "factor" && (
        <ConfirmDialog
          title={t("set.mem.remove_two_step_sign_in", { name: asking.u.displayName })}
          confirmLabel={t("set.mem.remove_two_step_sign_in_2")}
          busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const u = asking.u;
            setAsking(null);
            void run(async () => {
              await api(`/api/users/${u.id}/factor`, { method: "DELETE" });
            }, `factor-${u.id}`);
          }}
        >
          <p>{t("set.mem.they_are_signed_out_of")}</p>
        </ConfirmDialog>
      )}
      {removingNameless && (
        <ConfirmDialog
          title={t("set.mem.remove_name_3", { name: removingNameless.name })}
          confirmLabel={t("set.mem.remove_name_4", { name: removingNameless.name })}
          busy={busy}
          onCancel={() => setRemovingNameless(null)}
          onConfirm={() => {
            const m = removingNameless;
            setRemovingNameless(null);
            void run(async () => {
              await api("/api/admin/household-members", { method: "PUT", body: { members: namelessList.filter((x) => x !== m) } });
            });
          }}
        >
          <p>{t("set.mem.the_name_is_removed_from")}</p>
        </ConfirmDialog>
      )}
      <Table
        caption={t("set.mem.household_members")}
        rows={rows}
        rowKey={(r) => r.key}
        columns={[
          {
            key: "name",
            label: t("set.mem.name"),
            kind: "text",
            rowHead: true,
            cell: (r) => (
              <>
                {r.name}
                {r.user?.id === me.id && <span className="badge">{t("set.mem.you")}</span>}
                {r.user?.mustChangePassword && <span className="badge warn">{t("set.mem.temporary_password")}</span>}
              </>
            ),
          },
          { key: "username", label: t("set.mem.username"), kind: "text", cell: (r) => r.user?.username ?? "" },
          { key: "role", label: t("set.mem.role"), kind: "text", cell: (r) => (!r.user ? t("set.mem.no_sign_in") : r.user.role === "admin" ? t("set.mem.administrator_2") : t("set.mem.member_2")) },
          { key: "added", label: t("set.mem.added"), kind: "date", cell: (r) => (r.user ? addedOn(r.user) : "") },
          {
            key: "actions",
            label: t("set.mem.actions"),
            headHidden: true,
            kind: "count",
            cell: (r) => {
              const u = r.user;
              if (!u) {
                return (
                  <Button variant="link" disabled={busy} aria-label={t("set.mem.remove_name_5", { name: r.name })} onClick={() => setRemovingNameless(r.nameless!)}>
                    {t("set.mem.remove")}
                  </Button>
                );
              }
              return (
                u.id !== me.id && (
                  <div className="form-row flush end">
                    <Button disabled={busy} aria-busy={(busy && doing === `reset-${u.id}`) || undefined} onClick={() => setAsking({ act: "reset", u })}>
                      {t("set.mem.reset_password")}
                    </Button>
                    {u.hasFactor && (
                      <Button variant="link" disabled={busy} aria-busy={(busy && doing === `factor-${u.id}`) || undefined} onClick={() => setAsking({ act: "factor", u })}>
                        {t("set.mem.remove_two_step_sign_in_2")}
                      </Button>
                    )}
                    <Button variant="link" disabled={busy} onClick={() => setAsking({ act: "remove", u })}>
                      {t("set.mem.remove")}
                    </Button>
                  </div>
                )
              );
            },
          },
        ]}
      />
    </div>
  );
}
