/**
 * Asetukset > Salasana (everyone, on the plain page), and on the technical page Omat istunnot (everyone: the signed-in
 * devices) and Turvallisuusloki (admin).
 */
import { useState } from "react";
import { api } from "../../api.ts";
import { dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { PasswordForm } from "../Auth.tsx";
import { useReportLoaded } from "./use-settings-page.ts";

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

export const KIND_LABEL: Record<string, string> = {
  login_ok: "Kirjautuminen",
  login_fail: "Epäonnistunut kirjautuminen",
  lockout: "Kirjautuminen estetty hetkeksi",
  new_device: "Kirjautuminen uudelta laitteelta",
  password_changed: "Salasana vaihdettu",
  password_reset_by_admin: "Ylläpitäjä nollasi salasanan",
  session_revoked: "Istunto kirjattiin ulos",
  user_created: "Jäsen lisätty",
  user_deleted: "Jäsen poistettu",
  ops_request: "Ylläpitopyyntö",
  ops_denied: "Ylläpitopyyntö estetty",
  ops_result: "Ylläpitopyynnön tulos",
  ops_download: "Varmuuskopio ladattu",
  ops_export: "Tiedot viety tiedostoon",
  ops_import: "Tiedot tuotu tiedostosta",
  ops_notice: "Ylläpidon ilmoitus",
  ops_watchdog: "Edellinen versio palautettiin",
  watchdog_notice: "Edellinen versio palautettiin, ilmoitus ylläpitäjälle",
  remote_access_on: "Etäkäyttö otettu käyttöön",
  remote_access_off: "Etäkäyttö otettu pois käytöstä",
  remote_access_failed: "Etäkäytön muutos epäonnistui",
  remote_access_reverted: "Etäkäyttö poistettu, koska kukaan ei päässyt sisään",
  cloudflare_token_saved: "Cloudflaren API-tunniste tallennettu",
  cloudflare_token_removed: "Cloudflaren API-tunniste poistettu",
  db_damaged: "Tietokanta vaurioitunut",
  db_restored: "Tietokanta palautettu varmuuskopiosta",
  data_reset: "Talouden tiedot tyhjennetty",
};

const kindLabel = (kind: string) => KIND_LABEL[kind] ?? (kind.startsWith("ops_") ? `Ylläpito: ${kind.slice(4).replace(/_/g, " ")}` : kind);

/** The card Salasana: a button that opens the three fields. The address `#salasana` opens them at once. */
export function Password({ openPassword }: { openPassword: boolean }) {
  const [open, setOpen] = useState(openPassword);
  const [changed, setChanged] = useState(false);
  // a link to the form while the page is open: the card is already there, so the address alone opens it
  const [seenOpen, setSeenOpen] = useState(openPassword);
  if (openPassword !== seenOpen) {
    setSeenOpen(openPassword);
    if (openPassword) setOpen(true);
  }

  return (
    <div className="card half" id={SETTINGS_ANCHOR.password}>
      <div className="card-head">
        <div>
          <h2>Salasana</h2>
        </div>
        {!open && !changed && (
          <button className="btn" type="button" onClick={() => setOpen(true)}>
            Vaihda salasana
          </button>
        )}
      </div>
      {changed ? (
        <div className="notice good" role="status">
          Salasana vaihdettu. Muut laitteet kirjattiin ulos.
        </div>
      ) : (
        open && <PasswordForm onDone={() => setChanged(true)} onCancel={() => setOpen(false)} />
      )}
    </div>
  );
}

/** The devices that are signed in, for the member whose page it is. */
export function Sessions({ onLoaded }: { onLoaded?: () => void }) {
  const sessions = useApi<{ sessions: Session[] }>("/api/security/sessions");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doing, setDoing] = useState("");
  useReportLoaded(sessions.data !== null || sessions.error !== null, onLoaded);

  const act = async (key: string, fn: () => Promise<unknown>, signsOut = false) => {
    if (busy) return;
    setBusy(true);
    setDoing(key);
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
          <h2>Omat istunnot</h2>
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <button className="btn" disabled={busy || others === 0} aria-busy={(busy && doing === "others") || undefined} onClick={() => void act("others", () => api("/api/security/sessions/revoke-all", { method: "POST", body: { keepCurrent: true } }))}>
            Kirjaa ulos muut laitteet
          </button>
          <button className="btn btn-danger" disabled={busy} aria-busy={(busy && doing === "all") || undefined} onClick={() => void act("all", () => api("/api/security/sessions/revoke-all", { method: "POST", body: {} }), true)}>
            Kirjaa ulos kaikki
          </button>
        </div>
      </div>
      {(error ?? sessions.error) && <div className="error">{error ?? sessions.error}</div>}
      <div className="table-wrap">
        <table className="ruled">
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
                  <button className="btn btn-small" disabled={busy} aria-busy={(busy && doing === `end-${s.id}`) || undefined} onClick={() => void act(`end-${s.id}`, () => api(`/api/security/sessions/${s.id}`, { method: "DELETE" }), s.current)}>
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
export function SecurityLog({ onLoaded }: { onLoaded?: () => void }) {
  const [kind, setKind] = useState("");
  const events = useApi<{ events: SecurityEvent[]; kinds: string[] }>(`/api/security/events${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`);
  useReportLoaded(events.data !== null || events.error !== null, onLoaded);
  return (
    <div className="card" id={SETTINGS_ANCHOR.securityLog}>
      <div className="card-head">
        <div>
          <h2>Turvallisuusloki</h2>
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Merkinnän tyyppi">
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
        <table className="ruled">
          <thead>
            <tr>
              <th>Aika</th>
              <th>Merkintä</th>
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
