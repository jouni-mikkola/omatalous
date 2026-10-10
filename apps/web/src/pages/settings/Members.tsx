/** Household members (admin): add, reset password, remove. */
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { date } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { User } from "../../types.ts";

export function Members({ me, onChange }: { me: User; onChange: () => void }) {
  const { data, error: loadError, reload } = useApi<{ users: User[] }>("/api/users");
  const [form, setForm] = useState({ username: "", displayName: "", role: "member" });
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<User | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
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
      {secret && (
        <div className="secret-box" role="status">
          Väliaikainen salasana käyttäjälle <strong>{secret.who}</strong>: <code>{secret.password}</code>
          <div className="small muted">Näytetään vain kerran.</div>
        </div>
      )}
      <form className="form-row" onSubmit={add}>
        <input type="text" placeholder="Käyttäjätunnus" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required pattern="[A-Za-z0-9._\-]{3,32}" aria-label="Käyttäjätunnus" />
        <input type="text" placeholder="Nimi" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} aria-label="Nimi" />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Rooli">
          <option value="member">Jäsen</option>
          <option value="admin">Ylläpitäjä</option>
        </select>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Lisää jäsen
        </button>
      </form>
      {(error ?? loadError) && <div className="error">{error ?? loadError}</div>}
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
                `${u.displayName} poistettiin.${r.revoked ? ` Pankkiyhteyksiä suljettiin ${r.revoked}.` : ""}${r.failed ? ` ${r.failed} pankkiyhteyttä ei saatu suljettua, ne vanhenevat pankissa itsestään.` : ""}`,
              );
            });
          }}
        >
          <p>Tilit, tapahtumat ja säännöt poistetaan heti. Pankkiyhteydet suljetaan myös pankissa.</p>
          <p>Varmuuskopioista tiedot poistuvat 14 päivässä. Päivitystä edeltävä kopio voi säilyä pidempään.</p>
        </ConfirmDialog>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nimi</th>
              <th>Tunnus</th>
              <th>Rooli</th>
              <th>Lisätty</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.displayName}
                  {u.id === me.id && <span className="badge">sinä</span>}
                  {u.mustChangePassword && <span className="badge warn">väliaikainen salasana</span>}
                </td>
                <td>{u.username}</td>
                <td>{u.role === "admin" ? "ylläpitäjä" : "jäsen"}</td>
                <td>{date(u.createdAt)}</td>
                <td className="num">
                  {u.id !== me.id && (
                    <div className="form-row" style={{ margin: 0, justifyContent: "flex-end" }}>
                      <button
                        className="btn btn-small"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Nollataanko käyttäjän ${u.displayName} salasana? Hänet kirjataan ulos kaikilta laitteilta.`)) return;
                          void run(async () => {
                            const r = await api<{ temporaryPassword: string }>(`/api/users/${u.id}/reset-password`, { method: "POST" });
                            setSecret({ who: u.username, password: r.temporaryPassword });
                          });
                        }}
                      >
                        Nollaa salasana
                      </button>
                      <button
                        className="btn btn-small btn-danger"
                        disabled={busy}
                        onClick={() => setRemoving(u)}
                      >
                        Poista
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
