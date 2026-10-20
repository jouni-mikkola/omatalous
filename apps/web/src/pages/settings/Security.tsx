/**
 * Asetukset > Salasana (everyone, on the plain page), and on the technical page Omat istunnot (everyone: the signed-in
 * devices) and Turvallisuusloki (admin).
 */
import { useState } from "react";
import { api } from "../../api.ts";
import { DataTable } from "../../components/table/DataTable.tsx";
import { dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { PasswordForm } from "../Auth.tsx";
import { useReportLoaded } from "./use-settings-page.ts";
import { WEB_EXTENSIONS } from "../../extensions.ts";

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
  session_revoked: "Laite kirjattiin ulos",
  user_created: "Jäsen lisätty",
  user_deleted: "Jäsen poistettu",
  role_changed: "Jäsenen rooli vaihdettu",
  bank_key_saved: "Oma pankkiavain tallennettu",
  bank_key_removed: "Oma pankkiavain poistettu",
  bank_app_key_made: "Yhteisen pankkisovelluksen avain luotu",
  bank_app_saved: "Yhteinen pankkisovellus tallennettu",
  bank_app_removed: "Yhteinen pankkisovellus poistettu",
  factor_on: "Kaksivaiheinen kirjautuminen otettu käyttöön",
  factor_off: "Kaksivaiheinen kirjautuminen poistettu käytöstä",
  factor_removed_by_admin: "Ylläpitäjä poisti kaksivaiheisen kirjautumisen",
  recovery_codes_made: "Uudet palautuskoodit luotu",
  recovery_code_used: "Kirjautuminen palautuskoodilla",
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
  remote_access_reverted: "Etäkäyttö otettu pois käytöstä, koska kukaan ei päässyt sisään",
  cloudflare_token_saved: "Cloudflaren API-tunniste tallennettu",
  cloudflare_token_removed: "Cloudflaren API-tunniste poistettu",
  db_damaged: "Tietokanta vaurioitunut",
  db_restored: "Tietokanta palautettu varmuuskopiosta",
  data_reset: "Talouden tiedot tyhjennetty",
};

const kindLabel = (kind: string) =>
  KIND_LABEL[kind] ?? WEB_EXTENSIONS.find((e) => e.securityLabels?.[kind])?.securityLabels?.[kind] ?? (kind.startsWith("ops_") ? `Ylläpito: ${kind.slice(4).replace(/_/g, " ")}` : kind);

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
export function Sessions({ onLoaded }: { onLoaded?: (failed: boolean) => void }) {
  const sessions = useApi<{ sessions: Session[] }>("/api/security/sessions");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doing, setDoing] = useState("");
  useReportLoaded(sessions.data !== null || sessions.error !== null, onLoaded, sessions.error !== null);

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
      <DataTable
        id="sessions"
        caption="Omat istunnot"
        rows={sessions.data?.sessions ?? []}
        rowKey={(s) => s.id}
        phone="cards"
        columns={[
          {
            key: "device",
            label: "Laite",
            kind: "text",
            rowHead: true,
            cell: (s) => (
              <>
                {s.device}
                {s.current && <span className="badge">tämä laite</span>}
              </>
            ),
          },
          { key: "created", label: "Kirjautunut", kind: "date", phone: "hide", cell: (s) => dateTime(s.createdAt) },
          { key: "seen", label: "Viimeksi käytetty", kind: "date", cell: (s) => dateTime(s.lastSeenAt) },
          {
            key: "end",
            label: "",
            kind: "count",
            cell: (s) => (
              <button className="btn btn-small" disabled={busy} aria-busy={(busy && doing === `end-${s.id}`) || undefined} onClick={() => void act(`end-${s.id}`, () => api(`/api/security/sessions/${s.id}`, { method: "DELETE" }), s.current)}>
                Kirjaa ulos
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}

/** The admin's list of logins, lockouts, key changes and maintenance requests of the last 90 days. */
export function SecurityLog({ onLoaded }: { onLoaded?: (failed: boolean) => void }) {
  const [kind, setKind] = useState("");
  const events = useApi<{ events: SecurityEvent[]; kinds: string[] }>(`/api/security/events${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`);
  useReportLoaded(events.data !== null || events.error !== null, onLoaded, events.error !== null);
  return (
    <div className="card" id={SETTINGS_ANCHOR.securityLog}>
      <div className="card-head">
        <div>
          <h2>Turvallisuusloki</h2>
        </div>
        <label className="field field-inline">
          Näytä
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Kaikki</option>
          {(events.data?.kinds ?? Object.keys(KIND_LABEL)).map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        </label>
      </div>
      {events.error && <div className="error">{events.error}</div>}
      <div className="table-wrap">
        <DataTable
          id="security-events"
          caption="Turvallisuusloki"
          rows={events.data?.events ?? []}
          rowKey={(e) => String(e.id)}
          phone="cards"
          columns={[
            { key: "at", label: "Aika", kind: "date", rowHead: true, cell: (e) => dateTime(e.at) },
            { key: "kind", label: "Merkintä", kind: "text", cell: (e) => kindLabel(e.kind) },
            { key: "user", label: "Käyttäjä", kind: "text", cell: (e) => e.username ?? "" },
            { key: "device", label: "Laite", kind: "text", phone: "hide", cell: (e) => e.device ?? "" },
            { key: "ip", label: "Osoite", kind: "text", phone: "hide", cell: (e) => <span className="small">{e.ip ?? ""}</span> },
            { key: "detail", label: "Lisätieto", kind: "text", cell: (e) => <span className="small muted">{e.detail ?? ""}</span> },
          ]}
        />
        {events.data && !events.data.events.length && <div className="empty">Ei merkintöjä.</div>}
      </div>
    </div>
  );
}
