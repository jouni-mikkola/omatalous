/**
 * Instance setup forms (admin), shared by the first-run wizard and
 * Asetukset > Palvelin. The server validates everything again; the checks
 * here only give faster feedback.
 */
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api.ts";
import { copyText } from "../../clipboard.ts";
import { dateTime } from "../../format.ts";
import type { InstanceSettings, InstanceState } from "../../types.ts";

const HISTORY_OPTIONS = [
  [90, "3 kuukautta"],
  [180, "6 kuukautta"],
  [365, "1 vuosi"],
  [730, "2 vuotta"],
] as const;
const MAX_SYNCS = 4;
const APP_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A .pem key is a few kilobytes; the server refuses anything over 16 KB. */
const MAX_KEY_BYTES = 16 * 1024;
const DEFAULT_RELAY = "https://jouni-mikkola.github.io/omatalous/paluu/";

function timeZones(): string[] {
  const all = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["Europe/Helsinki", "Europe/Stockholm", "UTC"];
  // the household's own zone first
  return ["Europe/Helsinki", ...all.filter((z) => z !== "Europe/Helsinki")];
}

const hh = (h: number) => `${String(h).padStart(2, "0")}.15`;

export function syncHoursLabel(hours: number[]): string {
  return hours.length ? hours.map(hh).join(", ") : "vain käsin";
}

/** Same rule as the server (parseBaseUrl): http or https, a host, no path. */
function addressProblem(value: string): string | null {
  const message = "Anna osoite muodossa https://talous.oma.fi (ilman polkua).";
  try {
    const u = new URL(value);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.pathname.replace(/\/+$/, "") || u.search || u.hash) return message;
    return null;
  } catch {
    return value ? message : "Anna osoite.";
  }
}

// ── address, time zone, schedule ─────────────────────────

export function GeneralForm({
  state,
  initialAddress,
  submitLabel,
  onSaved,
  extraActions,
}: {
  state: InstanceState;
  /** The wizard suggests the address the admin is using right now. */
  initialAddress?: string;
  submitLabel: string;
  onSaved: (next: InstanceState) => void;
  extraActions?: ReactNode;
}) {
  const [form, setForm] = useState<Omit<InstanceSettings, "setupDone">>(() => ({
    appBaseUrl: initialAddress ?? state.settings.appBaseUrl,
    timezone: state.settings.timezone,
    syncHours: state.settings.syncHours,
    historyDays: state.settings.historyDays,
    industryLookup: state.settings.industryLookup,
  }));
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const zones = useMemo(timeZones, []);

  const plainHttp = /^http:\/\//.test(form.appBaseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$|\/)/.test(form.appBaseUrl);
  const toggleHour = (h: number) =>
    setForm((f) => ({ ...f, syncHours: f.syncHours.includes(h) ? f.syncHours.filter((x) => x !== h) : [...f.syncHours, h].sort((a, b) => a - b) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setSaved(false);
    const problem = addressProblem(form.appBaseUrl);
    if (problem) {
      setUrlError(problem);
      urlInput.current?.focus();
      return;
    }
    setUrlError(null);
    setBusy(true);
    try {
      const next = await api<InstanceState>("/api/admin/instance", { method: "PUT", body: form });
      setSaved(true);
      onSaved(next);
    } catch (err) {
      const message = (err as Error).message;
      // the server's address message belongs next to the address field
      if (/^Anna osoite/.test(message)) {
        setUrlError(message);
        urlInput.current?.focus();
      } else setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="setup-form" onSubmit={submit} noValidate>
      <label>
        <span className="field-label">Sovelluksen osoite</span>
        <input
          ref={urlInput}
          type="url"
          value={form.appBaseUrl}
          onChange={(e) => {
            setForm({ ...form, appBaseUrl: e.target.value.trim() });
            setUrlError(null);
          }}
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? "err-address" : undefined}
          maxLength={200}
          placeholder="https://talous.oma.fi"
          spellCheck={false}
          autoComplete="off"
        />
        {urlError && (
          <span className="error" id="err-address">
            {urlError}
          </span>
        )}
      </label>
      {plainHttp && (
        <div className="notice warning">Yhteys ei ole salattu. Käytä HTTPS:ää, jos sovellus näkyy kotiverkon ulkopuolella.</div>
      )}

      <div className="field-grid">
        <label>
          <span className="field-label">Aikavyöhyke</span>
          <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Haettava historia</span>
          <select value={form.historyDays} onChange={(e) => setForm({ ...form, historyDays: Number(e.target.value) })}>
            {HISTORY_OPTIONS.map(([days, label]) => (
              <option key={days} value={days}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="hour-picker">
        <legend className="field-label">
          Automaattinen haku <span className="muted">({syncHoursLabel(form.syncHours)})</span>
        </legend>
        <div className="hours" role="group" aria-label="Hakuajat">
          {Array.from({ length: 24 }, (_, h) => {
            const on = form.syncHours.includes(h);
            return (
              <button key={h} type="button" aria-pressed={on} disabled={!on && form.syncHours.length >= MAX_SYNCS} onClick={() => toggleHour(h)} aria-label={`klo ${hh(h)}`}>
                {String(h).padStart(2, "0")}
              </button>
            );
          })}
        </div>
        <span className="field-help">Enintään {MAX_SYNCS} kertaa päivässä.</span>
      </fieldset>

      <label className="check">
        <input type="checkbox" checked={form.industryLookup} onChange={(e) => setForm({ ...form, industryLookup: e.target.checked })} />
        <span>
          Hae tuntemattomien kauppiaiden toimiala YTJ:stä
          <span className="field-help">YTJ:hen lähtee vain kauppiaan nimi.</span>
        </span>
      </label>

      {error && <div className="error">{error}</div>}
      <div className="form-row">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Tallennetaan…" : submitLabel}
        </button>
        {saved && !error && <span className="small muted">Tallennettu.</span>}
        {extraActions}
      </div>
    </form>
  );
}

// ── the household's Enable Banking application ───────────

type Mode = "generate" | "upload";

export function BankAppSetup({
  state,
  onState,
}: {
  state: InstanceState;
  onState: (next: InstanceState) => void;
  /** Unused since the trailing encryption note was dropped; kept until Server.tsx stops passing it. */
  compact?: boolean;
}) {
  const app = state.bankApp;
  const [changing, setChanging] = useState(false);
  const [mode, setMode] = useState<Mode>("generate");
  const [appId, setAppId] = useState("");
  const [keyFile, setKeyFile] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const idInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  // the Application ID is tried against Enable Banking as soon as it is pasted (one call per distinct id and key)
  const [check, setCheck] = useState<{ busy: boolean; result: { verified: boolean; message: string } | null }>({ busy: false, result: null });
  const checked = useRef("");

  const keyReady = mode === "generate" ? app.pendingSince !== null : keyFile !== null;
  useEffect(() => {
    if (!APP_ID.test(appId) || !keyReady) {
      checked.current = "";
      setCheck({ busy: false, result: null });
      return;
    }
    const signature = `${appId}|${mode}|${keyFile?.name ?? ""}|${keyFile?.text.length ?? 0}|${app.pendingSince ?? ""}`;
    if (checked.current === signature) return;
    checked.current = signature;
    setCheck({ busy: true, result: null });
    const body = mode === "upload" ? { appId, privateKeyPem: keyFile?.text ?? "" } : { appId };
    api<{ verified: boolean; message: string }>("/api/admin/bank-app/check", { method: "POST", body })
      .then((result) => checked.current === signature && setCheck({ busy: false, result }))
      .catch((err: Error) => checked.current === signature && setCheck({ busy: false, result: { verified: false, message: err.message } }));
  }, [appId, mode, keyFile, keyReady, app.pendingSince]);

  const run = async (key: string, fn: () => Promise<InstanceState>) => {
    if (busy) return null;
    setBusy(key);
    setMessage(null);
    try {
      const next = await fn();
      onState(next);
      if (next.result) setMessage({ ok: next.result.verified, text: next.result.message });
      return next;
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const readKey = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return setKeyFile(null);
    if (file.size > MAX_KEY_BYTES) {
      setKeyFile(null);
      return setFileError("Tiedosto ei ole avain. Valitse Enable Bankingin .pem-tiedosto.");
    }
    setKeyFile({ name: file.name, text: await file.text() });
  };

  const activate = async (e: FormEvent) => {
    e.preventDefault();
    if (!APP_ID.test(appId)) {
      setIdError(appId ? "Application ID on muotoa 12345678-abcd-…" : "Anna Application ID.");
      idInput.current?.focus();
      return;
    }
    if (mode === "upload" && !keyFile) {
      setFileError("Valitse avaintiedosto.");
      fileInput.current?.focus();
      return;
    }
    const body = mode === "upload" ? { appId, privateKeyPem: keyFile?.text ?? "" } : { appId };
    const next = await run("activate", () => api<InstanceState>("/api/admin/bank-app", { method: "PUT", body }));
    if (next) {
      setKeyFile(null); // the key does not stay in the page
      setAppId("");
      setChanging(false);
    }
  };

  const copyRedirect = async () => {
    // on failure the URL stays selectable in the page
    if (await copyText(app.redirectUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!state.secret.available) {
    return (
      <div className="notice warning">
        Palvelimen salausavain puuttuu (<code>/secrets/app_secret</code>). Loki aukeaa komennolla <code>docker compose logs banking</code>.
      </div>
    );
  }

  const configured = app.source !== null;
  const showSetup = !configured || changing || app.pendingSince !== null;

  return (
    <div className="stack" style={{ gap: 12 }}>
      {configured && (
        <div className="bank-app-status">
          <div>
            <span className="badge good">käytössä</span> Application ID <code>{app.appId}</code>
            <div className="small muted">
              {app.source === "web" ? `Tallennettu ${dateTime(app.savedAt)}.` : "Määritetty palvelimen ympäristömuuttujilla (EB_APP_ID)."}
            </div>
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <button className="btn" type="button" disabled={busy !== null} onClick={() => run("test", () => api<InstanceState>("/api/admin/bank-app/test", { method: "POST" }))}>
              {busy === "test" ? "Testataan…" : "Testaa yhteys"}
            </button>
            {app.hasCertificate && !app.pendingSince && (
              <a className="btn" href="/api/admin/bank-app/certificate" download>
                Lataa varmenne
              </a>
            )}
            {!changing && !app.pendingSince && (
              <button className="btn" type="button" onClick={() => setChanging(true)}>
                Vaihda sovellus
              </button>
            )}
            {app.source === "web" && (
              <button
                className="btn btn-danger"
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm("Poistetaanko Enable Banking -sovellus? Pankkiyhteydet lakkaavat toimimasta.")) {
                    void run("remove", () => api<InstanceState>("/api/admin/bank-app", { method: "DELETE" }));
                  }
                }}
              >
                Poista
              </button>
            )}
          </div>
        </div>
      )}

      {showSetup && (
        <>
          <ul className="checklist" aria-label="Enable Banking -sovelluksen vaiheet">
            <li className={keyReady || configured ? "done" : undefined}>{mode === "generate" ? "Avain luotu" : "Avaintiedosto valittu"}</li>
            {mode === "generate" && <li className={downloaded || configured ? "done" : undefined}>Varmenne ladattu Enable Bankingiin</li>}
            <li className={check.result?.verified || configured ? "done" : undefined}>
              {check.busy ? "Application ID testataan…" : "Application ID toimii"}
            </li>
          </ul>

          <ol className="setup-steps">
            {mode === "generate" && (
              <li>
                Luo avain ja lataa varmenne.
                <div className="form-row">
                  {app.pendingSince ? (
                    <>
                      <span className="badge good">avain luotu {dateTime(app.pendingSince)}</span>
                      <a className="btn btn-primary" href="/api/admin/bank-app/certificate" download onClick={() => setDownloaded(true)}>
                        Lataa varmenne (.crt)
                      </a>
                      <button
                        className="btn btn-small"
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          // the certificate already uploaded to Enable Banking stops matching
                          if (!window.confirm("Uusi avain korvaa nykyisen. Enable Bankingiin pitää ladata uusi varmenne. Jatketaanko?")) return;
                          void run("key", () => api<InstanceState>("/api/admin/bank-app/key", { method: "POST" }));
                        }}
                      >
                        Luo uusi
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-primary" type="button" disabled={busy !== null} onClick={() => run("key", () => api<InstanceState>("/api/admin/bank-app/key", { method: "POST" }))}>
                      {busy === "key" ? "Luodaan…" : "Luo avain"}
                    </button>
                  )}
                </div>
              </li>
            )}
            <li>
              Rekisteröi sovellus Enable Bankingissa (
              <a href="https://enablebanking.com" target="_blank" rel="noopener noreferrer">
                enablebanking.com
              </a>
              ) kohdassa Control Panel &gt; API applications &gt; <em>Add a new application</em>.
              <ul className="small">
                <li>
                  Environment: <strong>Production</strong>
                </li>
                {mode === "generate" ? (
                  <li>
                    Private key: <strong>Generate outside the browser and import public certificate</strong>, tiedosto <code>talous-enablebanking.crt</code>
                  </li>
                ) : (
                  <li>
                    Private key: <strong>Generate in the browser</strong>
                  </li>
                )}
                <li>
                  Allowed redirect URLs:{" "}
                  <code className="copyable" onClick={copyRedirect} title="Kopioi">
                    {app.redirectUrl}
                  </code>{" "}
                  <button className="btn btn-small" type="button" onClick={copyRedirect}>
                    {copied ? "Kopioitu" : "Kopioi"}
                  </button>
                </li>
                <li>
                  Application name: <strong>Omatalous</strong>
                </li>
                <li>Muut kentät voi täyttää vapaasti. Paina Register.</li>
              </ul>
              {app.redirectMode === "relay" && (
                <div className="small muted">Pankki palauttaa selaimen tämän sivun kautta kotiverkon osoitteeseesi. Sivu ei tallenna mitään.</div>
              )}
              {app.redirectMode === "paste" && (
                <div className="small muted">
                  Paluusivu ei aukea. Liitä sen osoite kohtaan Asetukset &gt; Pankkiyhteydet, kun Nordea näyttää virhesivun.
                </div>
              )}
            </li>
            <li>
              Linkitä tilit. Paina <em>Activate by linking accounts</em>, valitse Finland, Nordea ja Personal ja kirjaudu. Lisää muut tilit ja luottokortit
              yksi kerrallaan: <em>Link accounts</em>.
            </li>
            <li>
              Tallenna Application ID{mode === "upload" ? " ja avaintiedosto." : "."}
              <form className="form-row" onSubmit={activate} noValidate>
                <input
                  ref={idInput}
                  type="text"
                  value={appId}
                  aria-invalid={idError ? true : undefined}
                  aria-describedby={idError ? "err-appid" : undefined}
                  onChange={(e) => {
                    setAppId(e.target.value.trim());
                    setIdError(null);
                  }}
                  placeholder="Application ID (12345678-abcd-…)"
                  aria-label="Application ID"
                  spellCheck={false}
                  autoComplete="off"
                  style={{ flex: "1 1 260px" }}
                />
                {mode === "upload" && (
                  <input ref={fileInput} type="file" accept=".pem,.key" onChange={(e) => void readKey(e.target.files?.[0])} aria-label="Yksityinen avain (.pem)" aria-invalid={fileError ? true : undefined} />
                )}
                <button className="btn btn-primary" type="submit" disabled={busy !== null || (mode === "generate" && !app.pendingSince)}>
                  {busy === "activate" ? "Tallennetaan…" : "Tallenna ja testaa"}
                </button>
                {changing && (
                  <button className="btn" type="button" onClick={() => setChanging(false)}>
                    Peruuta
                  </button>
                )}
                {idError && (
                  <span className="error field-error" id="err-appid">
                    {idError}
                  </span>
                )}
                {fileError && <span className="error field-error">{fileError}</span>}
              </form>
              {check.result && <div className={check.result.verified ? "notice good" : "notice warning"}>{check.result.message}</div>}
              {mode === "upload" && <div className="small muted">Poista .pem Lataukset-kansiosta.</div>}
            </li>
          </ol>
          <details className="small" open={mode === "upload" || undefined}>
            <summary className="muted">Muut vaihtoehdot</summary>
            <div className="form-row">
              {mode === "generate" ? (
                <button className="btn btn-small" type="button" onClick={() => setMode("upload")}>
                  Minulla on .pem-tiedosto
                </button>
              ) : (
                <button className="btn btn-small" type="button" onClick={() => setMode("generate")}>
                  Luo avain tässä
                </button>
              )}
            </div>
          </details>
        </>
      )}

      {configured && !showSetup && app.redirectMode === "paste" && (
        <div className="notice">
          Paluusivu helpottaa pankkiyhteyden lisäämistä. Lisää <code>{DEFAULT_RELAY}</code> Enable Bankingin sovelluksen Redirect URLs -kohtaan ja paina Ota käyttöön.{" "}
          <button className="btn btn-small" type="button" disabled={busy !== null} onClick={() => run("relay", () => api<InstanceState>("/api/admin/instance/redirect-mode", { method: "PUT", body: { mode: "relay" } }))}>
            Ota käyttöön
          </button>
        </div>
      )}

      {message && <div className={message.ok ? "notice good" : "notice warning"}>{message.text}</div>}
    </div>
  );
}
