/**
 * The household's Enable Banking application (admin), shared by the first-run wizard and Asetukset > Palvelin:
 * the key, the values to type into Enable Banking's registration form, and the Application ID with its test.
 */
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import { copyText } from "../../clipboard.ts";
import { dateTime } from "../../format.ts";
import type { InstanceState } from "../../types.ts";
import "../../styles/settings.css";

const APP_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A .pem key is a few kilobytes; the server refuses anything over 16 KB. */
const MAX_KEY_BYTES = 16 * 1024;
/** Enable Banking's Control Panel (its application list) and the page where an account is made. */
const EB_PANEL = "https://enablebanking.com/cp/applications";
const EB_SIGN_IN = "https://enablebanking.com/sign-in/";
/** The values the registration form asks for that do not depend on the install. */
const APP_NAME = "Omatalous";
const APP_DESCRIPTION = "Omatalous: kotitalouden oma taloussovellus";

type Mode = "generate" | "upload";

/** A value to paste into Enable Banking, with a button that copies it. When copying fails the text stays selectable. */
function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <>
      <code className="copyable" onClick={copy} title="Kopioi">
        {value}
      </code>{" "}
      <button className="btn btn-small" type="button" aria-label={`${copied ? "Kopioitu" : "Kopioi"} ${label}`} onClick={copy}>
        {copied ? "Kopioitu" : "Kopioi"}
      </button>
    </>
  );
}

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
              {app.source === "web" ? `Tallennettu ${dateTime(app.savedAt)}.` : "Asetettu palvelimen ympäristömuuttujalla EB_APP_ID."}
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
                          if (!window.confirm("Uusi avain korvaa nykyisen, ja Enable Bankingiin pitää ladata uusi varmenne. Jatketaanko?")) return;
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
              Rekisteröi sovellus Enable Bankingissa kohdassa Control Panel &gt; API applications &gt; <em>Add a new application</em>.
              <div className="form-row">
                <a className="btn btn-small" href={EB_PANEL} target="_blank" rel="noopener noreferrer">
                  Avaa Enable Banking
                </a>
                <span className="small muted">
                  Jos sinulla ei ole tiliä,{" "}
                  <a href={EB_SIGN_IN} target="_blank" rel="noopener noreferrer">
                    luo se ensin
                  </a>
                  .
                </span>
              </div>
              <ul className="small">
                <li>
                  <span className="eb-label">Environment</span>: <strong>Production</strong>
                </li>
                {mode === "generate" ? (
                  <li>
                    <span className="eb-label">Private key</span>: <strong>Generate outside the browser and import public certificate</strong>, tiedosto{" "}
                    <code>talous-enablebanking.crt</code>
                  </li>
                ) : (
                  <li>
                    <span className="eb-label">Private key</span>: <strong>Generate in the browser</strong>
                  </li>
                )}
                <li>
                  <span className="eb-label">Application name</span>: <CopyValue value={APP_NAME} label="Application name" />
                </li>
                <li>
                  <span className="eb-label">Allowed redirect URLs</span>: <CopyValue value={app.redirectUrl} label="Allowed redirect URLs" />
                </li>
                <li>
                  <span className="eb-label">Application description</span>: <CopyValue value={APP_DESCRIPTION} label="Application description" />
                </li>
                <li>
                  <span className="eb-label">Email for data protection matters</span>: oma sähköpostiosoitteesi
                </li>
                <li>
                  <span className="eb-label">Privacy URL</span>: <CopyValue value={app.privacyUrl} label="Privacy URL" />
                </li>
                <li>
                  <span className="eb-label">Terms URL</span>: <CopyValue value={app.termsUrl} label="Terms URL" />
                </li>
              </ul>
              <div className="small muted">Paina lopuksi Register.</div>
              {app.redirectMode === "paste" && (
                <div className="small muted">
                  Kun Nordea näyttää lopuksi virhesivun, liitä sen osoite kohtaan Asetukset &gt; Pankkiyhteydet.
                </div>
              )}
            </li>
            <li>
              Linkitä tilit. Paina <em>Activate by linking accounts</em>, valitse Finland, Nordea ja Personal ja kirjaudu. Lisää muut tilit ja luottokortit
              yksi kerrallaan kohdasta <em>Link accounts</em>.
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
          Ota paluusivu käyttöön: lisää <code>{app.relayUrl}</code> Enable Bankingin sovelluksen Redirect URLs -kohtaan ja paina Ota käyttöön.{" "}
          <button className="btn btn-small" type="button" disabled={busy !== null} onClick={() => run("relay", () => api<InstanceState>("/api/admin/instance/redirect-mode", { method: "PUT", body: { mode: "relay" } }))}>
            Ota käyttöön
          </button>
        </div>
      )}

      {message ? (
        <div className={message.ok ? "notice good" : "notice warning"}>{message.text}</div>
      ) : (
        app.inactiveMessage && <div className="notice warning">{app.inactiveMessage}</div>
      )}
    </div>
  );
}
