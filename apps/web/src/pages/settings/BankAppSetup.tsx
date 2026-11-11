/**
 * The household's Enable Banking application (admin), shared by the first-run wizard and Asetukset > Pankit ja tilit:
 * the key, the values to type into Enable Banking's registration form, and the Application ID with its test.
 */
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import { dateTime } from "../../format.ts";
import type { InstanceState } from "../../types.ts";
import { useBankSeen } from "./bank-seen.ts";
import { BankRedirectTest } from "./BankRedirectTest.tsx";
import { CopyAll, Copyable } from "./CopyValue.tsx";
import "../../styles/settings.css";
import { Button } from "../../components/ui/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { rich, t } from "../../text.ts";
const APP_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A .pem key is a few kilobytes; the server refuses anything over 16 KB. */
const MAX_KEY_BYTES = 16 * 1024;
/** Enable Banking's Control Panel (its application list) and the page where an account is made. */
const EB_PANEL = "https://enablebanking.com/cp/applications";
const EB_SIGN_IN = "https://enablebanking.com/sign-in/";
/** The values the registration form asks for that do not depend on the install. */
const APP_NAME = "Omatalous";
const appDescription = () => t("set.app.description");

const CERTIFICATE_URL = "/api/admin/bank-app/certificate";

type Mode = "generate" | "upload";

/** Starts a download the server sends as an attachment, as if its link was clicked. */
export function startDownload(url: string, doc: Document = document): void {
  const link = doc.createElement("a");
  link.href = url;
  link.download = "";
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
}

/**
 * Whether a test that passed is followed by a save at once: only while no app is saved (a saved one is changed with the
 * button), and only when the result is for the Application ID and key on screen now, not for an earlier paste.
 */
export function autoSaveWanted(saved: boolean, busy: boolean, signature: string, check: { signature: string; result: { verified: boolean } | null }): boolean {
  return !saved && !busy && signature !== "" && check.signature === signature && check.result?.verified === true;
}

export function BankAppSetup({
  state,
  onState,
  calm,
}: {
  state: InstanceState;
  onState: (next: InstanceState) => void;
  /** On Asetukset, where Yhdistä pankki is the one primary button and the guide is folded until it is asked for; the first-run wizard has no other and shows it. */
  calm?: boolean;
}) {
  const app = state.bankApp;
  const [changing, setChanging] = useState(false);
  const [guideAsked, setGuideAsked] = useState(false);
  const [asking, setAsking] = useState<"remove" | "key" | null>(null);
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
  // the Application ID is tried against Enable Banking as soon as it is pasted (one call per distinct id and key);
  // the result carries the id and key it is for, so a result of an earlier paste is never taken for the one on screen
  const [check, setCheck] = useState<{ signature: string; busy: boolean; result: { verified: boolean; message: string } | null }>({ signature: "", busy: false, result: null });
  const banksSeen = useBankSeen(app.appId);
  const checked = useRef("");
  const autoSaved = useRef("");

  const keyReady = mode === "generate" ? app.pendingSince !== null : keyFile !== null;
  const signature = APP_ID.test(appId) && keyReady ? `${appId}|${mode}|${keyFile?.name ?? ""}|${keyFile?.text.length ?? 0}|${app.pendingSince ?? ""}` : "";
  useEffect(() => {
    if (!signature) {
      checked.current = "";
      autoSaved.current = "";
      setCheck({ signature: "", busy: false, result: null });
      return;
    }
    if (checked.current === signature) return;
    checked.current = signature;
    setCheck({ signature, busy: true, result: null });
    const body = mode === "upload" ? { appId, privateKeyPem: keyFile?.text ?? "" } : { appId };
    api<{ verified: boolean; message: string }>("/api/admin/bank-app/check", { method: "POST", body })
      .then((result) => checked.current === signature && setCheck({ signature, busy: false, result }))
      .catch((err: Error) => checked.current === signature && setCheck({ signature, busy: false, result: { verified: false, message: err.message } }));
  }, [signature, appId, mode, keyFile]);

  const needsSave = autoSaveWanted(app.source !== null, busy !== null, signature, check);
  useEffect(() => {
    if (!needsSave || autoSaved.current === signature) return;
    autoSaved.current = signature;
    void save(true);
  }, [needsSave, signature]);

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
      return setFileError(t("set.app.the_file_is_not_a"));
    }
    setKeyFile({ name: file.name, text: await file.text() });
  };

  /** Saves the Application ID (with the uploaded key) and tests it again; `auto` is the save that follows a passed test. */
  const save = async (auto: boolean) => {
    const body = mode === "upload" ? { appId, privateKeyPem: keyFile?.text ?? "" } : { appId };
    const next = await run("activate", () => api<InstanceState>("/api/admin/bank-app", { method: "PUT", body }));
    if (next) {
      setKeyFile(null); // the key does not stay in the page
      setAppId("");
      setChanging(false);
      // nobody pressed a button, so say what happened
      if (auto && next.result?.verified) setMessage({ ok: true, text: t("set.app.application_id_saved_the_connection") });
    }
  };

  const activate = (e: FormEvent) => {
    e.preventDefault();
    if (!APP_ID.test(appId)) {
      setIdError(appId ? t("set.app.the_application_id_looks_like") : t("set.app.enter_the_application_id"));
      idInput.current?.focus();
      return;
    }
    if (mode === "upload" && !keyFile) {
      setFileError(t("set.app.choose_the_key_file"));
      fileInput.current?.focus();
      return;
    }
    void save(false);
  };

  /** A new key's certificate downloads by itself, so it is in the downloads folder when Enable Banking asks for it. */
  const makeKey = async () => {
    const next = await run("key", () => api<InstanceState>("/api/admin/bank-app/key", { method: "POST" }));
    if (next?.bankApp.pendingSince) {
      startDownload(CERTIFICATE_URL);
      setDownloaded(true);
    }
  };

  if (!state.secret.available) {
    return (
      <Notice tone="warning">
        {rich("set.app.no_secret")}
      </Notice>
    );
  }

  // what Enable Banking's registration form asks for; the email is the household's own
  const registration = [
    { label: "Application name", value: APP_NAME },
    { label: "Allowed redirect URLs", value: app.redirectUrl },
    { label: "Application description", value: appDescription() },
    { label: "Privacy URL", value: app.privacyUrl },
    { label: "Terms URL", value: app.termsUrl },
  ];
  const configured = app.source !== null;
  const showSetup = !configured || changing || app.pendingSince !== null;
  // a key made or a change begun is a step taken, so the guide stays open
  const guideFolded = !!calm && !configured && !changing && !guideAsked && app.pendingSince === null;

  return (
    <div className="stack stack-12">
      {configured && (
        <div className="bank-app-status">
          <div>
            <span className="badge good">{t("set.app.in_use")}</span> {t("set.app.id_label")} <code>{app.appId}</code>
            <div className="small muted">
              {app.source === "web" ? t("set.app.saved_on", { date: dateTime(app.savedAt) }) : t("set.app.set_by_the_server_s")}
            </div>
          </div>
          <div className="form-row flush">
            <Button disabled={busy !== null} aria-busy={busy === "test" || undefined} onClick={() => run("test", () => api<InstanceState>("/api/admin/bank-app/test", { method: "POST" }))}>
              {busy === "test" ? t("set.app.testing") : t("set.app.test_the_connection")}
            </Button>
            {app.hasCertificate && !app.pendingSince && (
              <Button href="/api/admin/bank-app/certificate" download>
                {t("set.app.download_certificate")}
              </Button>
            )}
            {!changing && !app.pendingSince && (
              <Button onClick={() => setChanging(true)}>
                {t("set.app.change_application")}
              </Button>
            )}
            {app.source === "web" && (
              <Button
                
                disabled={busy !== null}
                aria-busy={busy === "remove" || undefined}
                onClick={() => setAsking("remove")}
              >
                {t("set.app.remove")}
              </Button>
            )}
          </div>
        </div>
      )}

      {configured && <BankRedirectTest redirectUrl={app.redirectUrl} />}

      <ul className="checklist" aria-label={t("set.app.steps_of_the_enable_banking")}>
        <li className={keyReady || configured ? "done" : undefined}>{mode === "generate" ? t("set.app.key_made") : t("set.app.key_file_chosen")}</li>
        {mode === "generate" && <li className={downloaded || configured ? "done" : undefined}>{t("set.app.certificate_uploaded_to_enable_banking")}</li>}
        <li className={check.result?.verified || (configured && !app.inactiveMessage && message?.ok !== false) ? "done" : undefined}>
          {check.busy ? t("set.app.testing_the_application_id") : t("set.app.application_id_works")}
        </li>
        <li className={banksSeen ? "done" : undefined}>{t("set.app.accounts_added_in_enable_banking")}</li>
      </ul>
      {configured && !showSetup && !banksSeen && (
        <div className="small muted">
          {rich("set.app.press_activate")}{" "}
          <Button variant="link" href={EB_PANEL} target="_blank" rel="noopener noreferrer">
            {t("set.app.open_control_panel")}
          </Button>
        </div>
      )}


      {showSetup && guideFolded && (
        <div className="form-row">
          <Button onClick={() => setGuideAsked(true)}>{t("set.app.show_guide")}</Button>
        </div>
      )}

      {showSetup && !guideFolded && (
        <>
          <ol className="setup-steps">
            <li>
              {t("set.app.sign_in_to_enable_banking")}
              <div className="form-row">
                <Button variant="link" href={EB_SIGN_IN} target="_blank" rel="noopener noreferrer">
                  {t("set.app.open_sign_in")}
                </Button>
              </div>
            </li>
            {mode === "generate" && (
              <li>
                {t("set.app.make_a_key_the_certificate")}
                <div className="form-row">
                  {app.pendingSince ? (
                    <>
                      <span className="badge good">{t("set.app.key_made_on", { date: dateTime(app.pendingSince) })}</span>
                      <Button href={CERTIFICATE_URL} download onClick={() => setDownloaded(true)}>
                        {t("set.app.download_certificate_crt")}
                      </Button>
                      <Button
                        
                        disabled={busy !== null}
                        aria-busy={busy === "key" || undefined}
                        onClick={() => setAsking("key")}
                      >
                        {t("set.app.make_a_new_one")}
                      </Button>
                    </>
                  ) : (
                    <Button variant={calm ? undefined : "primary"} disabled={busy !== null} aria-busy={busy === "key" || undefined} onClick={() => void makeKey()}>
                      {busy === "key" ? t("set.app.making") : t("set.app.make_key")}
                    </Button>
                  )}
                </div>
              </li>
            )}
            <li>
              {rich("set.app.open_applications")}
              <div className="form-row">
                <Button variant="link" href={EB_PANEL} target="_blank" rel="noopener noreferrer">
                  {t("set.app.open_enable_banking")}
                </Button>
              </div>
              <ul>
                <li>
                  <span className="eb-label">Environment</span>: <strong>Production</strong>
                </li>
                {mode === "generate" ? (
                  <li>
                    <span className="eb-label">Private key</span>: {rich("set.app.choose_outside")}
                  </li>
                ) : (
                  <li>
                    <span className="eb-label">Private key</span>: {rich("set.app.choose_inside")}
                  </li>
                )}
                <li>
                  <span className="eb-label">Application name</span>: <Copyable value={APP_NAME} />
                </li>
                <li>
                  <span className="eb-label">Allowed redirect URLs</span>: <Copyable value={app.redirectUrl} />
                  {app.redirectMode === "own" && <div className="small muted">{t("set.app.trust_certificate")}</div>}
                </li>
                <li>
                  <span className="eb-label">Application description</span>: <Copyable value={appDescription()} />
                </li>
                <li>
                  <span className="eb-label">Email for data protection matters</span>: {t("set.app.your_email")}
                </li>
                <li>
                  <span className="eb-label">Privacy URL</span>: <Copyable value={app.privacyUrl} />
                </li>
                <li>
                  <span className="eb-label">Terms URL</span>: <Copyable value={app.termsUrl} />
                </li>
              </ul>
              <div className="form-row">
                <CopyAll fields={registration} />
              </div>
              <div className="small muted">{rich("set.app.press_register")}</div>
            </li>
            <li>
              {rich("set.app.activate_steps")}
              <div className="form-row">
                <Button variant="link" href={EB_PANEL} target="_blank" rel="noopener noreferrer">
                  {t("set.app.open_control_panel")}
                </Button>
              </div>
            </li>
            <li>
              {configured
                ? t(mode === "upload" ? "set.app.save_id_and_key" : "set.app.save_id")
                : t(mode === "upload" ? "set.app.paste_id_and_key" : "set.app.paste_id")}
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
                  placeholder={t("set.app.application_id_12345678_abcd")}
                  aria-label={t("set.app.id_label")}
                  spellCheck={false}
                  autoComplete="off"
                  className="bank-app-id"
                />
                {mode === "upload" && (
                  <input ref={fileInput} type="file" accept=".pem,.key" onChange={(e) => void readKey(e.target.files?.[0])} aria-label={t("set.app.private_key_pem")} aria-invalid={fileError ? true : undefined} aria-describedby={fileError ? "err-keyfile" : undefined} />
                )}
                <Button variant={calm ? undefined : "primary"} type="submit" disabled={busy !== null || (mode === "generate" && !app.pendingSince)} aria-busy={busy === "activate" || undefined}>
                  {busy === "activate" ? t("set.app.saving") : t("set.app.save_and_test")}
                </Button>
                {changing && (
                  <Button onClick={() => setChanging(false)}>
                    {t("set.app.cancel")}
                  </Button>
                )}
                {idError && (
                  <span className="field-error" id="err-appid">
                    {idError}
                  </span>
                )}
                {fileError && (
                  <span className="field-error" id="err-keyfile" role="alert">
                    {fileError}
                  </span>
                )}
              </form>
              {check.result && <Notice tone={check.result.verified ? "good" : "warning"}>{check.result.message}</Notice>}
              {mode === "upload" && <div className="small muted">{t("set.app.delete_the_pem_file_from")}</div>}
            </li>
          </ol>
          <details className="small" open={mode === "upload" || undefined}>
            <summary className="muted">{t("set.app.other_options")}</summary>
            <div className="form-row">
              {mode === "generate" ? (
                <Button variant="link" onClick={() => setMode("upload")}>
                  {t("set.app.i_have_a_pem_file")}
                </Button>
              ) : (
                <Button variant="link" onClick={() => setMode("generate")}>
                  {t("set.app.make_the_key_here")}
                </Button>
              )}
            </div>
          </details>
        </>
      )}

      {configured && !showSetup && app.redirectMode === "paste" && (
        <Notice>
          {rich("set.app.add_relay", { url: app.relayUrl })}{" "}
          <Button disabled={busy !== null} aria-busy={busy === "relay" || undefined} onClick={() => run("relay", () => api<InstanceState>("/api/admin/instance/redirect-mode", { method: "PUT", body: { mode: "relay" } }))}>
            {t("set.app.turn_on")}
          </Button>
        </Notice>
      )}

      {message ? (
        <Notice tone={message.ok ? "good" : "warning"}>{message.text}</Notice>
      ) : (
        app.inactiveMessage && <Notice tone="warning">{app.inactiveMessage}</Notice>
      )}

      {asking === "remove" && (
        <ConfirmDialog
          title={t("set.app.remove_the_enable_banking_application")}
          confirmLabel={t("set.app.remove_application")}
          onConfirm={() => {
            setAsking(null);
            void run("remove", () => api<InstanceState>("/api/admin/bank-app", { method: "DELETE" }));
          }}
          onCancel={() => setAsking(null)}
        >
          <p>{t("set.app.bank_connections_will_stop_working")}</p>
        </ConfirmDialog>
      )}
      {asking === "key" && (
        <ConfirmDialog
          title={t("set.app.make_a_new_key")}
          confirmLabel={t("set.app.make_new_key")}
          onConfirm={() => {
            setAsking(null);
            void makeKey();
          }}
          onCancel={() => setAsking(null)}
        >
          {/* the certificate already uploaded to Enable Banking stops matching */}
          <p>{t("set.app.the_new_key_replaces_the")}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
