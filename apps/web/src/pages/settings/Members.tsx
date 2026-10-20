/** Household members (admin): add, reset password, remove. */
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import { copyText } from "../../clipboard.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { DataTable } from "../../components/table/DataTable.tsx";
import { date } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { InstanceState, User } from "../../types.ts";
import { addressToSave } from "../Wizard.tsx";

/** What a new member needs to log in: the address, the username, the temporary password and that it must change. */
export function memberInstructions(address: string, username: string, password: string): string {
  return [
    `Omatalous: ${address}`,
    `Käyttäjätunnus: ${username}`,
    `Väliaikainen salasana: ${password}`,
    "Salasana pitää vaihtaa ensimmäisellä kirjautumiskerralla.",
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
      Väliaikainen salasana käyttäjälle <strong>{who}</strong>: <code>{password}</code>
      <div className="small muted">Näytetään vain kerran.</div>
      <button className="btn btn-small" type="button" onClick={() => void onCopy()}>
        {state === "copied" ? "Kopioitu" : state === "failed" ? "Kopiointi ei onnistunut" : "Kopioi ohje"}
      </button>
    </div>
  );
}

const USERNAME = /^[A-Za-z0-9._-]{3,32}$/;
const USERNAME_HINT = "3–32 merkkiä: kirjaimet, numerot, piste, alaviiva tai viiva";

export function Members({ me, onChange, onLoaded }: { me: User; onChange: () => void; onLoaded?: () => void }) {
  const { data, error: loadError, reload } = useApi<{ users: User[] }>("/api/users");
  // the page scrolls to a card below this one only after this one has its height
  const done = data !== null || loadError !== null;
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
  const [removing, setRemoving] = useState<User | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const [badName, setBadName] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<void>, key = "") => {
    if (busy) return;
    setBusy(true);
    setDoing(key);
    setError(null);
    try {
      await fn();
      reload();
      onChange(); // member list in sharing settings
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!USERNAME.test(form.username)) {
      setError(USERNAME_HINT);
      setBadName(true);
      nameField.current?.focus();
      return;
    }
    setBadName(false);
    void run(async () => {
      const r = await api<{ user: User; temporaryPassword: string }>("/api/users", { method: "POST", body: form });
      setSecret({ who: r.user.username, password: r.temporaryPassword });
      setForm({ username: "", displayName: "", role: "member" });
    });
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Talouden jäsenet</h2>
        </div>
      </div>
      {secret && <SecretBox key={`${secret.who}:${secret.password}`} who={secret.who} password={secret.password} address={address} />}
      <form className="form-row form-fields" onSubmit={add} noValidate>
        <label className="field">
          Käyttäjätunnus
          <input ref={nameField} type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required aria-invalid={badName || undefined} aria-describedby="tunnus-ohje" />
          <span className="field-hint" id="tunnus-ohje">{USERNAME_HINT}</span>
        </label>
        <label className="field">
          Nimi
          <input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </label>
        <label className="field">
          Rooli
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="member">Jäsen</option>
            <option value="admin">Ylläpitäjä</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
          Lisää jäsen
        </button>
      </form>
      {(error ?? loadError) && <div className="error" role="alert">{error ?? loadError}</div>}
      {removed && <div className="notice good" role="status">{removed}</div>}
      {removing && (
        <ConfirmDialog
          title={`Poistetaanko ${removing.displayName}?`}
          confirmLabel="Poista"
          busy={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const u = removing;
            setRemoving(null);
            setRemoved(null);
            void run(async () => {
              const r = await api<{ revoked: number; failed: number }>(`/api/users/${u.id}`, { method: "DELETE" });
              setRemoved(
                `${u.displayName} poistettiin.${r.revoked ? ` Pankkiyhteyksiä suljettiin ${r.revoked}.` : ""}${r.failed ? ` ${r.failed} pankkiyhteyttä jäi sulkematta. Ne vanhenevat pankissa itsestään.` : ""}`,
              );
            });
          }}
        >
          <p>Tilit, tapahtumat ja säännöt poistetaan heti. Pankkiyhteydet suljetaan myös pankissa.</p>
          <p>Varmuuskopioista tiedot poistuvat 14 päivässä, päivitystä edeltävästä kopiosta myöhemmin.</p>
        </ConfirmDialog>
      )}
      <DataTable
        id="members"
        className="members-table"
        caption="Talouden jäsenet"
        rows={data?.users ?? []}
        rowKey={(u) => u.id}
        phone="cards"
        columns={[
          {
            key: "name",
            label: "Nimi",
            kind: "text",
            rowHead: true,
            cell: (u) => (
              <>
                {u.displayName}
                {u.id === me.id && <span className="badge">sinä</span>}
                {u.mustChangePassword && <span className="badge warn">väliaikainen salasana</span>}
              </>
            ),
          },
          { key: "username", label: "Tunnus", kind: "text", cell: (u) => u.username },
          { key: "role", label: "Rooli", kind: "text", cell: (u) => (u.role === "admin" ? "ylläpitäjä" : "jäsen") },
          { key: "added", label: "Lisätty", kind: "date", cell: (u) => date(u.createdAt) },
          {
            key: "actions",
            label: "",
            kind: "count",
            cell: (u) => (
              <>

            {u.id !== me.id && (
              <div className="form-row" style={{ margin: 0, justifyContent: "flex-end" }}>
                <button
                  className="btn btn-small"
                  disabled={busy}
                  aria-busy={(busy && doing === `reset-${u.id}`) || undefined}
                  onClick={() => {
                    if (!window.confirm(`Nollataanko käyttäjän ${u.displayName} salasana? Hänet kirjataan ulos kaikilta laitteilta.`)) return;
                    void run(async () => {
                      const r = await api<{ temporaryPassword: string }>(`/api/users/${u.id}/reset-password`, { method: "POST" });
                      setSecret({ who: u.username, password: r.temporaryPassword });
                    }, `reset-${u.id}`);
                  }}
                >
                  Nollaa salasana
                </button>
                {u.hasFactor && (
                  <button
                    className="btn btn-small"
                    disabled={busy}
                    aria-busy={(busy && doing === `factor-${u.id}`) || undefined}
                    onClick={() => {
                      if (!window.confirm(`Poistetaanko käyttäjän ${u.displayName} kaksivaiheinen kirjautuminen? Hänet kirjataan ulos kaikilta laitteilta.`)) return;
                      void run(async () => {
                        await api(`/api/users/${u.id}/factor`, { method: "DELETE" });
                      }, `factor-${u.id}`);
                    }}
                  >
                    Poista kaksivaiheinen kirjautuminen
                  </button>
                )}
                <button
                  className="btn btn-small btn-danger"
                  disabled={busy}
                  onClick={() => setRemoving(u)}
                >
                  Poista
                </button>
              </div>
            )}
          
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
