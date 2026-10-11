/**
 * Asetukset > Kirjautuminen (everyone: a new password, the signed-in devices) and Asetukset > Turvallisuusloki
 * (admin, in the Talous tab).
 */
import { useState } from "react";
import { api } from "../../api.ts";
import { dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { PasswordForm } from "../Auth.tsx";

interface Session {
  id: string;
  device: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

interface SecurityEvent {
  id: number;
  at: string;
  kind: string;
  username: string | null;
  ip: string | null;
  device: string | null;
  detail: string | null;
}

const KIND_LABEL: Record<string, string> = {
  login_ok: "Kirjautuminen",
  login_fail: "Epäonnistunut kirjautuminen",
  lockout: "Kirjautuminen estetty hetkeksi",
  new_device: "Uusi laite",
  password_changed: "Salasana vaihdettu",
  password_reset_by_admin: "Ylläpitäjä nollasi salasanan",
  session_revoked: "Istunto päätetty",
  user_created: "Jäsen lisätty",
  user_deleted: "Jäsen poistettu",
  ops_request: "Ylläpitopyyntö",
  ops_denied: "Ylläpitopyyntö estetty",
  ops_result: "Ylläpitopyynnön tulos",
  ops_download: "Varmuuskopion lataus",
  ops_notice: "Ylläpidon ilmoitus",
};

const kindLabel = (kind: string) => KIND_LABEL[kind] ?? (kind.startsWith("ops_") ? `Ylläpito: ${kind.slice(4).replace(/_/g, " ")}` : kind);

/** The way in: a new password and the devices that are signed in. The address `#salasana` opens the password form. */
export function Login({ openPassword }: { openPassword: boolean }) {
  const sessions = useApi<{ sessions: Session[] }>("/api/security/sessions");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(openPassword);
  // a link to the form while the page is open: the card is already there, so the address alone opens it
  const [seenOpen, setSeenOpen] = useState(openPassword);
  if (openPassword !== seenOpen) {
    setSeenOpen(openPassword);
    if (openPassword) setPasswordOpen(true);
  }

  const act = async (fn: () => Promise<unknown>, signsOut = false) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (signsOut) window.location.reload();
      else sessions.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const others = sessions.data?.sessions.filter((s) => !s.current).length ?? 0;

  return (
    <div className="card" id={SETTINGS_ANCHOR.login}>
      <div className="card-head">
        <div>
          <h2>Kirjautuminen</h2>
        </div>
      </div>

      <details id={SETTINGS_ANCHOR.password} open={passwordOpen} onToggle={(e) => setPasswordOpen(e.currentTarget.open)}>
        <summary className="small muted">Vaihda salasana</summary>
        {changed ? (
          <div className="notice good" role="status">
            Salasana vaihdettu. Muut laitteet kirjautuvat ulos.
          </div>
        ) : (
          <PasswordForm
            onDone={() => {
              setChanged(true);
              sessions.reload();
            }}
          />
        )}
      </details>

      <div className="card-head" style={{ marginTop: 16 }}>
        <h3 className="subhead">Omat istunnot</h3>
        <div className="form-row" style={{ margin: 0 }}>
          <button className="btn" disabled={busy || others === 0} onClick={() => void act(() => api("/api/security/sessions/revoke-all", { method: "POST", body: { keepCurrent: true } }))}>
            Kirjaa ulos muut laitteet
          </button>
          <button className="btn btn-danger" disabled={busy} onClick={() => void act(() => api("/api/security/sessions/revoke-all", { method: "POST", body: {} }), true)}>
            Kirjaa ulos kaikki
          </button>
        </div>
      </div>
      {(error ?? sessions.error) && <div className="error">{error ?? sessions.error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Laite</th>
              <th className="hide-phone">Kirjauduttu</th>
              <th>Viimeksi käytetty</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.data?.sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.device}
                  {s.current && <span className="badge">tämä laite</span>}
                </td>
                <td className="hide-phone">{dateTime(s.createdAt)}</td>
                <td>{dateTime(s.lastSeenAt)}</td>
                <td className="num">
                  <button className="btn btn-small" disabled={busy} onClick={() => void act(() => api(`/api/security/sessions/${s.id}`, { method: "DELETE" }), s.current)}>
                    Kirjaa ulos
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The admin's list of logins, lockouts, key changes and maintenance requests of the last 90 days. */
export function SecurityLog() {
  const [kind, setKind] = useState("");
  const events = useApi<{ events: SecurityEvent[]; kinds: string[] }>(`/api/security/events${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`);
  return (
    <div className="card" id={SETTINGS_ANCHOR.securityLog}>
      <div className="card-head">
        <div>
          <h2>Turvallisuusloki</h2>
          <div className="card-sub">Merkinnät säilyvät 90 päivää.</div>
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tapahtumatyyppi">
          <option value="">Kaikki</option>
          {(events.data?.kinds ?? Object.keys(KIND_LABEL)).map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
      </div>
      {events.error && <div className="error">{events.error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Aika</th>
              <th>Tapahtuma</th>
              <th>Käyttäjä</th>
              <th className="hide-phone">Laite</th>
              <th className="hide-phone">Osoite</th>
              <th>Lisätieto</th>
            </tr>
          </thead>
          <tbody>
            {events.data?.events.map((e) => (
              <tr key={e.id}>
                <td>{dateTime(e.at)}</td>
                <td>{kindLabel(e.kind)}</td>
                <td>{e.username ?? ""}</td>
                <td className="hide-phone">{e.device ?? ""}</td>
                <td className="small hide-phone">{e.ip ?? ""}</td>
                <td className="small muted">{e.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.data && !events.data.events.length && <div className="empty">Ei merkintöjä.</div>}
      </div>
    </div>
  );
}
