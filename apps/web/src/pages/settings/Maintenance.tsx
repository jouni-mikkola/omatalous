/**
 * The Ylläpito cards of the technical page (admin): update, rollback, backup, restart, doctor, logs, prune and helper
 * renewal through the host helper. Without the helper every one of them is off, so the cards are what the helper is, the
 * version and the reset of the data; the other cards are not drawn. The cards are a fragment: the page holds them.
 */
import { useEffect, useState } from "react";
import { api, apiDownload, ApiError, saveFile } from "../../api.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { BackupList } from "../../components/ops/BackupList.tsx";
import { DoctorList } from "../../components/ops/DoctorList.tsx";
import { HelperStatus } from "../../components/ops/HelperStatus.tsx";
import { OpsProgress } from "../../components/ops/OpsProgress.tsx";
import { prereleaseAction, prereleaseOn, S, showsPrerelease } from "../../components/ops/ops-strings.ts";
import { ResetCard } from "../../components/ops/ResetCard.tsx";
import { RestoreLatest } from "../../components/ops/RestoreLatest.tsx";
import { ToolsPanel } from "../../components/ops/ToolsPanel.tsx";
import { PasswordDialog } from "../../components/ops/PasswordDialog.tsx";
import type { AuditEvent, OpsAction, OpsState } from "../../components/ops/types.ts";
import { UpdatePanel } from "../../components/ops/UpdatePanel.tsx";
import { restartWait } from "../../components/ops/ops-elapsed.ts";
import { usePolled } from "../../components/ops/use-polled.ts";
import { dateTime } from "../../format.ts";
import "../../styles/ops.css";

/** Polls every 3 s while something runs, every 60 s otherwise. A failing fetch (the app restarts) backs off. */
function useOpsState() {
  const { data, error, downSince, reload } = usePolled<OpsState>("/api/ops/state", (d) => (d.active || d.readOnlyActive ? 3000 : 60_000), undefined, restartWait);
  return { data, error, downSince, reload };
}

type Dialog = "update" | "rollback" | "download" | null;

export function Maintenance() {
  const { data, error, downSince, reload } = useOpsState();
  const audit = useApiAudit(data?.requests[0] ? `${data.requests[0].id}:${data.requests[0].status}` : "");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const request = async (action: OpsAction, extra: { password?: string; confirm?: string } = {}) => {
    await api("/api/ops/request", { method: "POST", body: { action, ...extra } });
    setMessage(null);
    await reload();
  };
  const quick = async (action: OpsAction) => {
    setPending(true);
    try {
      await request(action);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setPending(false);
    }
  };
  const cancel = async (id: string) => {
    try {
      await api(`/api/ops/cancel/${id}`, { method: "POST", body: {} });
      await reload();
    } catch (err) {
      setMessage((err as Error).message);
    }
  };
  const download = async (password: string) => {
    const { blob, filename } = await apiDownload("/api/ops/backups/latest", { password });
    saveFile(blob, filename);
    setDialog(null);
    await reload();
  };

  const helperOff = data?.helper.status === "off";
  // a mutating request is queued or running: one at a time
  const blocked = !data || helperOff || data.active || pending;
  const latest = data?.requests[0];
  const updateTo = S.updateTo(data?.state.latest_version);

  const panels = data && (
    <>
      <BackupList
        app={data.appBackups}
        host={data.state.backups ?? []}
        disabled={blocked}
        canDownload={data.appBackups.length > 0}
        onBackup={() => void quick("backup")}
        onDownload={() => setDialog("download")}
      />
      <RestoreLatest listKey={data.appBackups.map((b) => b.name).join()} disabled={data.active || pending} />
      <DoctorList doctor={data.state.doctor} disabled={helperOff || pending || data.readOnlyActive} onRun={() => void quick("doctor")} />
      <ToolsPanel
        disabled={blocked}
        readDisabled={helperOff || pending || data.readOnlyActive}
        supported={data.helper.tools || helperOff}
        enableCommand={data.helper.enableCommand}
        onLogs={() => void quick("logs")}
        onPrune={() => void quick("prune")}
        onRenew={() => void quick("helper-renew")}
      />
      <div className="card">
        <div className="card-head">
          <div>
            <h2>{S.restart}</h2>
            <div className="card-sub">{S.restartHelp}</div>
          </div>
          <button className="btn" type="button" disabled={blocked} onClick={() => void quick("restart")}>
            {S.restart}
          </button>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>{S.events}</h2>
        </div>
        {audit.length === 0 ? (
          <div className="empty">{S.noEvents}</div>
        ) : (
          <div className="table-wrap">
            <table className="ruled">
              <thead>
                <tr>
                  <th>Aika</th>
                  <th>Käyttäjä</th>
                  <th>Toiminto</th>
                  <th>Tulos</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((e) => (
                  <tr key={e.id}>
                    <td>{dateTime(e.at)}</td>
                    <td>{e.username ?? ""}</td>
                    <td>{e.action}</td>
                    <td className="small">{e.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <div className="card" id={SETTINGS_ANCHOR.maintenance}>
        <div className="card-head">
          <h2>{S.title}</h2>
        </div>
        {!data && !error && <div className="muted">Ladataan…</div>}
        {error && !data && <div className="error">{error}</div>}
        {data && <HelperStatus helper={data.helper} />}
        {message && <div className="notice warning" role="alert">{message}</div>}
        {data && latest && (
          <OpsProgress request={latest} down={downSince !== null && data.active} downSince={downSince} helperSeenAt={data.helper.seenAt ? Date.parse(data.helper.seenAt) : null} helperWakes={data.helper.wakes} onCancel={(id) => void cancel(id)} />
        )}
        {downSince !== null && data && !data.active && <div className="notice warning" role="status">{S.restarting}</div>}
      </div>

      {data && (
        <>
          <UpdatePanel
            version={data.version}
            build={data.build}
            state={data.state}
            disabled={blocked}
            prerelease={showsPrerelease(data.helper, data.state) ? { on: prereleaseOn(data.state, latest), onChange: (on) => void quick(prereleaseAction(on)) } : null}
            onCheck={() => void quick("check-update")}
            onUpdate={() => setDialog("update")}
            onRollback={() => setDialog("rollback")}
          />
          {!helperOff && panels}
          <ResetCard disabled={data.active || pending} />
        </>
      )}

      {dialog === "update" && (
        <PasswordDialog
          title={S.updateTitle}
          submitLabel={S.update}
          onCancel={() => setDialog(null)}
          onSubmit={async (password) => {
            await request("update", { password });
            setDialog(null);
          }}
        >
          {updateTo && <p>{updateTo}</p>}
          <ul>
            {S.updateBody.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </PasswordDialog>
      )}
      {dialog === "rollback" && (
        <PasswordDialog
          title={S.rollbackTitle}
          submitLabel={S.rollback}
          confirmWord="PALAUTA"
          danger
          onCancel={() => setDialog(null)}
          onSubmit={async (password, confirm) => {
            await request("rollback", { password, confirm });
            setDialog(null);
          }}
        >
          <p>{S.rollbackBody}</p>
          {data?.state.schema_changed && <p className="error">{S.rollbackSchema}</p>}
        </PasswordDialog>
      )}
      {dialog === "download" && (
        <PasswordDialog title={S.downloadTitle} submitLabel="Lataa" onCancel={() => setDialog(null)} onSubmit={download}>
          <p>{S.downloadBody}</p>
        </PasswordDialog>
      )}
    </>
  );
}

/** The event list, fetched again when the newest request changes. */
function useApiAudit(key: string): AuditEvent[] {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    api<{ events: AuditEvent[] }>("/api/ops/audit")
      .then((r) => !cancelled && setEvents(r.events))
      .catch((e: unknown) => {
        // the state call shows the same problem; a 403 here only means the role changed
        if (!(e instanceof ApiError)) console.error(e);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return events;
}
