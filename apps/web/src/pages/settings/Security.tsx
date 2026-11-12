/**
 * Asetukset > Turvallisuus: Salasana (everyone), Omat istunnot (everyone: the signed-in devices, and for an admin one row
 * for each service token, a read-only key of a script or an agent that is made on the server's command line) and
 * Turvallisuusloki (admin).
 */
import { type ReactNode, useState } from "react";
import { api } from "../../api.ts";
import { Table } from "../../components/table/Table.tsx";
import { dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { PasswordForm } from "../Auth.tsx";
import { useReportLoaded } from "./use-settings-page.ts";
import { WEB_EXTENSIONS } from "../../extensions.ts";
import { Button } from "../../components/ui/Button.tsx";
import { useInPlaceForm } from "../../components/ui/in-place-form.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import { Empty } from "../../components/ui/Empty.tsx";
import { labelTable, t } from "../../text.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
interface Session {
  id: string;
  device: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

interface ServiceToken {
  id: string;
  username: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
}

/** A row of the card: a signed-in device, or a service token. */
type Row = { key: string; session?: Session; token?: ServiceToken };

interface SecurityEvent {
  id: number;
  at: string;
  kind: string;
  username: string | null;
  ip: string | null;
  device: string | null;
  detail: string | null;
}

export const KIND_LABEL: Record<string, string> = labelTable({
  login_ok: () => t("set.sec.sign_in"),
  login_fail: () => t("set.sec.failed_sign_in"),
  lockout: () => t("set.sec.sign_in_blocked_for_a"),
  new_device: () => t("set.sec.sign_in_from_a_new"),
  password_changed: () => t("set.sec.password_changed"),
  password_reset_by_admin: () => t("set.sec.administrator_reset_the_password"),
  password_rehashed: () => t("set.sec.password_hash_updated"),
  session_revoked: () => t("set.sec.device_signed_out"),
  user_created: () => t("set.sec.member_added"),
  user_deleted: () => t("set.sec.member_removed"),
  role_changed: () => t("set.sec.member_s_role_changed"),
  bank_key_saved: () => t("set.sec.own_bank_key_saved"),
  bank_key_removed: () => t("set.sec.own_bank_key_removed"),
  bank_app_key_made: () => t("set.sec.key_of_the_shared_bank"),
  bank_app_saved: () => t("set.sec.shared_bank_app_saved"),
  bank_app_removed: () => t("set.sec.shared_bank_app_removed"),
  factor_on: () => t("set.sec.two_step_sign_in_turned"),
  factor_off: () => t("set.sec.two_step_sign_in_turned_2"),
  factor_removed_by_admin: () => t("set.sec.administrator_removed_two_step_sign"),
  passkey_added: () => t("set.sec.passkey_added"),
  passkey_removed: () => t("set.sec.passkey_removed"),
  passkey_used: () => t("set.sec.sign_in_with_a_passkey"),
  recovery_codes_made: () => t("set.sec.new_recovery_codes_made"),
  recovery_code_used: () => t("set.sec.sign_in_with_a_recovery"),
  ops_request: () => t("set.sec.maintenance_request"),
  ops_denied: () => t("set.sec.maintenance_request_refused"),
  ops_result: () => t("set.sec.result_of_a_maintenance_request"),
  ops_download: () => t("set.sec.backup_downloaded"),
  ops_export: () => t("set.sec.data_exported_to_a_file"),
  ops_import: () => t("set.sec.data_imported_from_a_file"),
  ops_notice: () => t("set.sec.maintenance_notice"),
  ops_watchdog: () => t("set.sec.previous_version_restored"),
  watchdog_notice: () => t("set.sec.previous_version_restored_administrator_notified"),
  remote_access_on: () => t("set.sec.remote_access_turned_on"),
  remote_access_off: () => t("set.sec.remote_access_turned_off"),
  remote_access_failed: () => t("set.sec.remote_access_change_failed"),
  remote_access_reverted: () => t("set.sec.remote_access_turned_off_because"),
  cloudflare_token_saved: () => t("set.sec.cloudflare_api_token_saved"),
  cloudflare_token_removed: () => t("set.sec.cloudflare_api_token_removed"),
  db_damaged: () => t("set.sec.database_damaged"),
  db_restored: () => t("set.sec.database_restored_from_a_backup"),
  data_reset: () => t("set.sec.household_data_cleared"),
  setup_completed: () => t("set.sec.setup_marked_as_done"),
  service_token_made: () => t("set.sec.service_token_made"),
  service_token_removed: () => t("set.sec.service_token_removed"),
  service_token_used: () => t("set.sec.service_token_used"),
  service_token_refused: () => t("set.sec.too_many_wrong_service_tokens"),
  limits_changed: () => t("set.sec.limits_changed"),
  notices_changed: () => t("set.sec.notice_settings_changed"),
  offsite_changed: () => t("set.sec.offsite_backup_target_changed"),
  module_code_set: () => t("set.sec.module_code_set"),
  module_code_removed: () => t("set.sec.module_code_removed"),
  module_installed: () => t("set.sec.module_installed"),
  module_refused: () => t("set.sec.module_refused"),
});

const kindLabel = (kind: string) =>
  KIND_LABEL[kind] ?? WEB_EXTENSIONS.find((e) => e.securityLabels?.[kind])?.securityLabels?.[kind] ?? (kind.startsWith("ops_") ? t("set.sec.maintenance_kind", { kind: kind.slice(4).replace(/_/g, " ") }) : kind);

/** The card Salasana: a button that opens the three fields. The address `#salasana` opens them at once. */
export function Password({ openPassword }: { openPassword: boolean }) {
  const { open, setOpen, region } = useInPlaceForm(openPassword);
  const [changed, setChanged] = useState(false);
  // a link to the form while the page is open: the card is already there, so the address alone opens it
  const [seenOpen, setSeenOpen] = useState(openPassword);
  if (openPassword !== seenOpen) {
    setSeenOpen(openPassword);
    if (openPassword) setOpen(true);
  }

  return (
    <div className="card half" id={SETTINGS_ANCHOR.password} {...region}>
      <div className="card-head">
        <div>
          <h2>{t("set.sec.password")}</h2>
        </div>
        {!open && !changed && (
          <Button data-opener onClick={() => setOpen(true)}>
            {t("set.sec.change_password")}
          </Button>
        )}
      </div>
      {changed ? (
        <Notice tone="good" role="status">
          {t("set.sec.password_changed_other_devices_were")}
        </Notice>
      ) : (
        open && <PasswordForm onDone={() => setChanged(true)} onCancel={() => setOpen(false)} />
      )}
    </div>
  );
}

/** The devices that are signed in, for the member whose page it is. */
export function Sessions({ admin = false, onLoaded }: { admin?: boolean; onLoaded?: (failed?: boolean) => void }) {
  const sessions = useApi<{ sessions: Session[] }>("/api/security/sessions");
  const tokens = useApi<{ tokens: ServiceToken[] }>(admin ? "/api/admin/service-tokens" : null);
  const [revoking, setRevoking] = useState<ServiceToken | null>(null);
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
  const rows: Row[] = [
    ...(sessions.data?.sessions ?? []).map((session) => ({ key: session.id, session })),
    ...(tokens.data?.tokens ?? []).map((token) => ({ key: `token-${token.id}`, token })),
  ];
  const withTokens = (tokens.data?.tokens.length ?? 0) > 0;

  return (
    <div className="card" id={SETTINGS_ANCHOR.login}>
      <div className="card-head">
        <div>
          <h2>{withTokens ? t("set.sec.sessions_and_service_tokens") : t("set.sec.your_sessions")}</h2>
        </div>
        <div className="form-row flush">
          {/* with no other session it would do what the key beside it does */}
          {others > 0 && (
            <Button disabled={busy} aria-busy={(busy && doing === "others") || undefined} onClick={() => void act("others", () => api("/api/security/sessions/revoke-all", { method: "POST", body: { keepCurrent: true } }))}>
              {t("set.sec.sign_out_other_devices")}
            </Button>
          )}
          <Button disabled={busy} aria-busy={(busy && doing === "all") || undefined} onClick={() => void act("all", () => api("/api/security/sessions/revoke-all", { method: "POST", body: {} }), true)}>
            {t("set.sec.sign_out_all_devices")}
          </Button>
        </div>
      </div>
      {(error ?? sessions.error ?? tokens.error) && <Notice tone="error">{error ?? sessions.error ?? tokens.error}</Notice>}
      <Table
        caption={withTokens ? t("set.sec.sessions_and_service_tokens") : t("set.sec.your_sessions")}
        rows={rows}
        rowKey={(r) => r.key}
        page={10}
        columns={[
          {
            key: "device",
            label: t("set.sec.device"),
            kind: "text",
            rowHead: true,
            cell: (r) =>
              r.token ? (
                <>
                  {t("set.sec.service_token_name")} {r.token.name}
                  <span className="badge">{r.token.username}</span>
                </>
              ) : (
                <>
                  {r.session!.device}
                  {r.session!.current && <span className="badge">{t("set.sec.this_device")}</span>}
                </>
              ),
          },
          { key: "created", label: t("set.sec.signed_in"), kind: "date", phone: "hide", cell: (r) => dateTime((r.session ?? r.token!).createdAt) },
          {
            key: "seen",
            label: t("set.sec.last_used"),
            kind: "date",
            cell: (r) => (r.session ? dateTime(r.session.lastSeenAt) : r.token!.lastUsedAt ? `${dateTime(r.token!.lastUsedAt)}${r.token!.lastUsedIp ? `, ${r.token!.lastUsedIp}` : ""}` : t("set.sec.not_yet")),
          },
          {
            key: "end",
            label: t("set.sec.actions"),
            headHidden: true,
            kind: "count",
            cell: (r) =>
              r.token ? (
                <Button disabled={busy} onClick={() => setRevoking(r.token!)}>
                  {t("set.sec.remove_token")}
                </Button>
              ) : (
                <Button disabled={busy} aria-busy={(busy && doing === `end-${r.session!.id}`) || undefined} onClick={() => void act(`end-${r.session!.id}`, () => api(`/api/security/sessions/${r.session!.id}`, { method: "DELETE" }), r.session!.current)}>
                  {t("set.sec.sign_out")}
                </Button>
              ),
          },
        ]}
      />
      {revoking && (
        <ConfirmDialog
          title={t("set.sec.revoke_title", { name: revoking.name })}
          confirmLabel={t("set.sec.remove_token")}
          onConfirm={() => {
            const t = revoking;
            setRevoking(null);
            void act(`token-${t.id}`, async () => {
              await api(`/api/admin/service-tokens/${encodeURIComponent(t.id)}`, { method: "DELETE" });
              tokens.reload();
            });
          }}
          onCancel={() => setRevoking(null)}
        >
          <p>{t("set.sec.the_program_that_uses_it")}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * What Lisätieto adds to the row. A failed login or lockout keeps the typed name, which says something only when no user
 * has it; of a known user it is the Käyttäjä column again. A passkey's label stays even when it is the user's name, and a
 * new device's label stays, as a phone hides the Laite column.
 * With nothing to add the cell is empty, so a phone's row block drops the label too (`td[data-label]:empty`).
 */
export function eventDetail(e: Pick<SecurityEvent, "kind" | "detail" | "username">): ReactNode {
  const typedName = (e.kind === "login_fail" || e.kind === "lockout") && e.detail === e.username;
  return e.detail === null || typedName ? "" : <span className="small muted">{e.detail}</span>;
}

/** The admin's list of logins, lockouts, key changes and maintenance requests of the last 90 days. */
export function SecurityLog({ onLoaded }: { onLoaded?: (failed?: boolean) => void }) {
  const [kind, setKind] = useState("");
  const events = useApi<{ events: SecurityEvent[]; kinds: string[] }>(`/api/security/events${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`);
  useReportLoaded(events.data !== null || events.error !== null, onLoaded, events.error !== null);
  return (
    <div className="card" id={SETTINGS_ANCHOR.securityLog}>
      <div className="card-head">
        <div>
          <h2>{t("set.sec.security_log")}</h2>
        </div>
        <label className="field field-inline">
          {t("set.sec.show")}
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t("set.sec.all")}</option>
          {(events.data?.kinds ?? Object.keys(KIND_LABEL)).map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        </label>
      </div>
      {events.error && <Notice tone="error">{events.error}</Notice>}
      <Table
        caption={t("set.sec.security_log")}
        rows={events.data?.events ?? []}
        rowKey={(e) => String(e.id)}
        page={25}
        key={kind}
        columns={[
          { key: "at", label: t("set.sec.time"), kind: "date", rowHead: true, cell: (e) => dateTime(e.at) },
          { key: "kind", label: t("set.sec.event"), kind: "text", cell: (e) => kindLabel(e.kind) },
          { key: "user", label: t("set.sec.user"), kind: "text", cell: (e) => e.username ?? "" },
          { key: "device", label: t("set.sec.device"), kind: "text", phone: "hide", cell: (e) => e.device ?? "" },
          { key: "ip", label: t("set.sec.address"), kind: "text", phone: "hide", cell: (e) => <span className="small">{e.ip ?? ""}</span> },
          { key: "detail", label: t("set.sec.details"), kind: "text", cell: eventDetail },
        ]}
      />
      {events.data && !events.data.events.length && <Empty>{t("set.sec.no_events")}</Empty>}
    </div>
  );
}
