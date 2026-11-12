/**
 * Asetukset > Palvelin > Ilmoitukset selaimen ulkopuolelle (admin only).
 * Decision: whether the household hears of an ending bank consent, a low disk, a missing backup or a rolled-back update
 * without opening the app, and where the message goes. Off until an admin turns it on. The address and the token go
 * to the server and never come back: the card shows only the host they lead to.
 */
import { FoldCard } from "../../components/ui/FoldCard.tsx";
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { useApi } from "../../hooks.ts";
import "../../styles/settings.css";
import { t } from "../../text.ts";

export interface NoticesView {
  enabled: boolean;
  configured: boolean;
  kind: "webhook" | "ntfy" | null;
  host: string | null;
  hasToken: boolean;
  secret: { available: boolean };
}

/** The line under the form about where the messages go now. */
function whereLine(v: NoticesView): string {
  if (!v.configured) return t("set.notices.no_address_given");
  const place = t(v.kind === "ntfy" ? "set.notices.place_ntfy" : "set.notices.place_url", { host: v.host ?? "" });
  return t(v.hasToken ? "set.notices.saved_place_token" : "set.notices.saved_place", { place });
}

export function OutsideNotices() {
  const loaded = useApi<NoticesView>("/api/admin/notices");
  const [state, setState] = useState<NoticesView | null>(null);
  const view = state ?? loaded.data;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const on = enabled ?? view?.enabled ?? false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const body: Record<string, unknown> = { enabled: on };
    if (address.trim()) body.address = address.trim();
    if (token.trim()) body.token = token.trim();
    try {
      setState(await api<NoticesView>("/api/admin/notices", { method: "PUT", body }));
      setAddress("");
      setToken("");
      setEnabled(null);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeToken = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await api<NoticesView>("/api/admin/notices", { method: "PUT", body: { token: null } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FoldCard id="ilmoitukset" title={t("set.notices.notices_outside_the_browser")} sub={view ? t(view.enabled ? "set.notices.state_on" : "set.notices.state_off") : undefined} folded={!view?.enabled}>
      <p>{t("set.notices.a_message_is_sent_when")}</p>
      {loaded.error && <Notice tone="warning">{loaded.error}</Notice>}
      {view && (
        <form className="setup-form" onSubmit={submit} noValidate>
          <label className="check">
            <input type="checkbox" checked={on} onChange={(e) => setEnabled(e.target.checked)} />
            <span>{t("set.notices.send_notices")}</span>
          </label>
          <label>
            <span className="field-label">{t("set.notices.address_or_ntfy_topic")}</span>
            <input name="notices-address" type="password" autoComplete="off" spellCheck={false} maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />
            <span className="field-help">{t("set.notices.address_help")} {whereLine(view)}</span>
          </label>
          <label>
            <span className="field-label">{t("set.notices.token_optional")}</span>
            <input name="notices-token" type="password" autoComplete="off" spellCheck={false} maxLength={300} value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          {!view.secret.available && <Notice tone="warning">{t("set.notices.the_server_s_encryption_key")}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          <div className="form-row">
            <Button variant="primary" type="submit" busy={busy}>
              {busy ? t("set.notices.saving") : t("set.notices.save")}
            </Button>
            {view.hasToken && (
              <Button onClick={removeToken} busy={busy}>
                {t("set.notices.remove_token")}
              </Button>
            )}
            {saved && !error && <span className="small muted">{t("set.notices.saved")}</span>}
          </div>
        </form>
      )}
    </FoldCard>
  );
}
