/** Asetukset > Turvallisuus: own sessions, and for admins the security event list. */
import { useState } from "react";
import { api } from "../../api.ts";
import { dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { User } from "../../types.ts";

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

export function Security({ me }: { me: User }) {
  const sessions = useApi<{ sessions: Session[] }>("/api/security/sessions");
  const [kind, setKind] = useState("");
  const events = useApi<{ events: SecurityEvent[]; kinds: string[] }>(me.role === "admin" ? `/api/security/events${kind ? `?kind=${encodeURIComponent(kind)}` : ""}` : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <div className="stack">
      <p>
        <a href="#/settings">← Asetukset</a>
      </p>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Omat istunnot</h2>
            <div className="card-sub">Laitteet, joilla olet kirjautuneena.</div>
          </div>
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
                <th>Kirjauduttu</th>
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
                  <td>{dateTime(s.createdAt)}</td>
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

      {me.role === "admin" && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Tapahtumaloki</h2>
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
                  <th>Laite</th>
                  <th>Osoite</th>
                  <th>Lisätieto</th>
                </tr>
              </thead>
              <tbody>
                {events.data?.events.map((e) => (
                  <tr key={e.id}>
                    <td>{dateTime(e.at)}</td>
                    <td>{kindLabel(e.kind)}</td>
                    <td>{e.username ?? ""}</td>
                    <td>{e.device ?? ""}</td>
                    <td className="small">{e.ip ?? ""}</td>
                    <td className="small muted">{e.detail ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {events.data && !events.data.events.length && <div className="empty">Ei merkintöjä.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
