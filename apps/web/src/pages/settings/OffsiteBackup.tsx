/**
 * Asetukset > Palvelin > Varmuuskopio toiselle koneelle (admin only).
 * Decision: whether the household keeps an encrypted copy on another machine, where it goes, and that they know where
 * the key that opens it must be kept. The card is shown first and with a recommendation, but nothing leaves the machine
 * until a target is given and the copy is turned on. The age secret key is shown once and never comes back; every change
 * asks for the admin's password.
 */
import { FoldCard } from "../../components/ui/FoldCard.tsx";
import { type FormEvent, useState } from "react";
import { api, saveFile } from "../../api.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { t } from "../../text.ts";
import "../../styles/settings.css";

export interface OffsiteView {
  enabled: boolean;
  hasKeys: boolean;
  unreadable: boolean;
  configured: boolean;
  host: string | null;
  port: number;
  user: string | null;
  dir: string | null;
  recipient: string | null;
  sshPublic: string | null;
  last: { ok: boolean; at: string; summary: string } | null;
  stale: boolean;
  secret: { available: boolean };
}

/** The line about the last copy: what the card says whether it worked. */
function lastLine(v: OffsiteView): string {
  if (!v.last) return t("offsite.last_none");
  return t(v.last.ok ? "offsite.last_ok" : "offsite.last_failed", { at: dateTime(v.last.at), summary: v.last.summary });
}

export function OffsiteBackup() {
  const loaded = useApi<OffsiteView>("/api/admin/offsite");
  const [state, setState] = useState<OffsiteView | null>(null);
  const view = state ?? loaded.data;
  const [ageSecret, setAgeSecret] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [host, setHost] = useState<string | null>(null);
  const [port, setPort] = useState<string | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [dir, setDir] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** One call with the password; the password is cleared after it. */
  const call = async (path: string, method: string, body: Record<string, unknown>, done: string | null, after?: (answer: never) => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const answer = await api<OffsiteView & { ageSecret?: string }>(path, { method, body: { password, ...body } });
      setPassword("");
      if (after) after(answer as never);
      else setState(answer);
      if (done) setNote(done);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const makeKeys = () =>
    call("/api/admin/offsite/keys", "POST", {}, null, (a: OffsiteView & { ageSecret: string }) => {
      setState(a);
      setAgeSecret(a.ageSecret);
      setRecipient(null);
      setEnabled(null);
      setConfirmed(false);
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!view) return;
    void call(
      "/api/admin/offsite",
      "PUT",
      { enabled: enabled ?? view.enabled, host: host ?? view.host ?? "", port: Number(port ?? view.port), user: user ?? view.user ?? "", dir: dir ?? view.dir ?? "", recipient: recipient ?? view.recipient, keyConfirmed: confirmed || view.enabled },
      t("offsite.saved"),
      (a: OffsiteView) => {
        setState(a);
        setEnabled(null);
      },
    );
  };

  const download = () => {
    if (ageSecret) saveFile(new Blob([`${ageSecret}\n`], { type: "text/plain" }), "omatalous-avain.txt");
  };

  const target = view?.configured ? `${view.user}@${view.host}:${view.dir}` : "";
  const on = enabled ?? view?.enabled ?? false;
  // the copy is turned on only after the admin says the key is saved
  const needsConfirm = on && !view?.enabled;

  return (
    <FoldCard
      id="varmuuskopio-toiselle-koneelle"
      title={
        <>
          {t("offsite.title")} <span className="badge">{t("offsite.recommended")}</span>
        </>
      }
      sub={view ? (view.configured ? (view.enabled ? t("offsite.state_set", { target }) : t("offsite.state_paused")) : t("offsite.state_off")) : undefined}
      folded={!view?.configured}
    >
      <p>{t("offsite.intro")}</p>
      <p>{t("offsite.key_reason")}</p>
      {loaded.error && <Notice tone="warning">{loaded.error}</Notice>}
      {view && (
        <>
          {view.configured && <p className="small muted">{lastLine(view)}</p>}
          {view.stale && <Notice tone="warning">{t("offsite.stale")}</Notice>}
          {view.unreadable && <Notice tone="warning">{t("offsite.unreadable")}</Notice>}
          {!view.secret.available && <Notice tone="warning">{t("offsite.no_secret_note")}</Notice>}
          <p className="small muted">{t("offsite.helper_note")}</p>
          <label>
            <span className="field-label">{t("offsite.password")}</span>
            <input name="offsite-password" type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <h3>{t("offsite.step_keys")}</h3>
          <div className="form-row">
            <Button onClick={makeKeys} busy={busy} disabled={!password || !view.secret.available}>
              {view.hasKeys ? t("offsite.make_keys_again") : t("offsite.make_keys")}
            </Button>
          </div>
          {ageSecret && (
            <Notice tone="warning">
              <strong>{t("offsite.secret_title")}</strong>
              <code className="block" data-testid="offsite-age-secret">
                {ageSecret}
              </code>
              <span>{t("offsite.secret_place")}</span>
              <Button onClick={download}>{t("offsite.secret_download")}</Button>
            </Notice>
          )}
          {view.sshPublic && (
            <div>
              <strong>{t("offsite.ssh_title")}</strong>
              <code className="block">{view.sshPublic}</code>
              <span className="field-help">{t("offsite.ssh_place")}</span>
            </div>
          )}
          {view.hasKeys && (
            <form className="setup-form" onSubmit={submit} noValidate>
              <h3>{t("offsite.step_target")}</h3>
              <label>
                <span className="field-label">{t("offsite.host_label")}</span>
                <input name="offsite-host" autoComplete="off" spellCheck={false} maxLength={253} value={host ?? view.host ?? ""} onChange={(e) => setHost(e.target.value)} />
              </label>
              <label>
                <span className="field-label">{t("offsite.port_label")}</span>
                <input name="offsite-port" inputMode="numeric" maxLength={5} value={port ?? String(view.port)} onChange={(e) => setPort(e.target.value)} />
              </label>
              <label>
                <span className="field-label">{t("offsite.user_label")}</span>
                <input name="offsite-user" autoComplete="off" spellCheck={false} maxLength={32} value={user ?? view.user ?? ""} onChange={(e) => setUser(e.target.value)} />
              </label>
              <label>
                <span className="field-label">{t("offsite.dir_label")}</span>
                <input name="offsite-dir" autoComplete="off" spellCheck={false} maxLength={120} value={dir ?? view.dir ?? ""} onChange={(e) => setDir(e.target.value)} />
                <span className="field-help">{t("offsite.dir_help")}</span>
              </label>
              <label>
                <span className="field-label">{t("offsite.recipient_label")}</span>
                <input name="offsite-recipient" autoComplete="off" spellCheck={false} maxLength={80} value={recipient ?? view.recipient ?? ""} onChange={(e) => setRecipient(e.target.value)} />
                <span className="field-help">{t("offsite.recipient_help")}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={on} onChange={(e) => setEnabled(e.target.checked)} />
                <span>{t("offsite.enable")}</span>
              </label>
              {needsConfirm && (
                <label className="check">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  <span>{t("offsite.secret_saved")}</span>
                </label>
              )}
              {error && <Notice tone="error">{error}</Notice>}
              <div className="form-row">
                <Button variant="primary" type="submit" busy={busy} disabled={!password || (needsConfirm && !confirmed)}>
                  {busy ? t("offsite.saving") : t("offsite.save")}
                </Button>
                {view.configured && (
                  <Button onClick={() => void call("/api/admin/offsite/run", "POST", {}, t("offsite.queued"), () => setState(null))} busy={busy} disabled={!password}>
                    {t("offsite.run_now")}
                  </Button>
                )}
                <Button danger onClick={() => void call("/api/admin/offsite", "DELETE", {}, t("offsite.removed"))} busy={busy} disabled={!password}>
                  {t("offsite.remove")}
                </Button>
                {note && !error && <span className="small muted">{note}</span>}
              </div>
            </form>
          )}
          {!view.hasKeys && error && <Notice tone="error">{error}</Notice>}
        </>
      )}
    </FoldCard>
  );
}
