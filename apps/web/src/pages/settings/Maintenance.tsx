/**
 * The Ylläpito cards of the technical page (admin): update, rollback, restart, doctor, logs, prune and helper
 * renewal through the host helper. Without the helper every one of them is off, so the cards are what the helper is, the
 * version and the reset of the data; the other cards are not drawn. The cards are a fragment: the page holds them.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../../api.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { DoctorList } from "../../components/ops/DoctorList.tsx";
import { HelperStatus } from "../../components/ops/HelperStatus.tsx";
import { OpsLog } from "../../components/ops/OpsLog.tsx";
import { OpsProgress } from "../../components/ops/OpsProgress.tsx";
import { S } from "../../components/ops/ops-strings.ts";
import { ResetCard } from "../../components/ops/ResetCard.tsx";
import { ToolFailures } from "../../components/ops/ToolFailures.tsx";
import { ToolsPanel } from "../../components/ops/ToolsPanel.tsx";
import { PasswordDialog } from "../../components/ops/PasswordDialog.tsx";
import type { AuditEvent, OpsAction, OpsState } from "../../components/ops/types.ts";
import { UpdatePanel } from "../../components/ops/UpdatePanel.tsx";
import { restartWait } from "../../components/ops/ops-elapsed.ts";
import { usePolled } from "../../components/ops/use-polled.ts";
import "../../styles/ops.css";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";
/** Polls every 3 s while something runs, every 60 s otherwise. A failing fetch (the app restarts) backs off. */
export function useOpsState() {
  const { data, error, downSince, reload } = usePolled<OpsState>("/api/ops/state", (d) => (d.active || d.readOnlyActive ? 3000 : 60_000), undefined, restartWait);
  return { data, error, downSince, reload };
}

type Dialog = "update" | "rollback" | null;

export function Maintenance({ ops }: { ops: ReturnType<typeof useOpsState> }) {
  const { data, error, downSince, reload } = ops;
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

  const helperOff = data?.helper.status === "off";
  // a mutating request is queued or running: one at a time
  const blocked = !data || helperOff || data.active || pending;
  const latest = data?.requests[0];
  const updateTo = S.updateTo(data?.state.latest_version);

  const panels = data && (
    <>
      <ToolsPanel
        disabled={blocked}
        readDisabled={helperOff || pending || data.readOnlyActive}
        supported={data.helper.tools || helperOff}
        enableCommand={data.helper.enableCommand}
        last={data.last}
        onDoctor={() => void quick("doctor")}
        onLogs={() => void quick("logs")}
        onPrune={() => void quick("prune")}
        onRenew={() => void quick("helper-renew")}
        onRestart={() => void quick("restart")}
      />
      <DoctorList doctor={data.state.doctor} stale={data.state.doctor_stale === true} />
      <OpsLog events={audit} />
    </>
  );

  return (
    <>
      <div className="card" id={SETTINGS_ANCHOR.maintenance}>
        <div className="card-head">
          <h2>{S.title}</h2>
        </div>
        {!data && !error && <div className="muted">{t("set.mt.loading")}</div>}
        {error && !data && <Notice tone="error">{error}</Notice>}
        {data && <HelperStatus helper={data.helper} />}
        {message && <Notice tone="warning" role="alert">{message}</Notice>}
        {data && latest && (
          <OpsProgress request={latest} down={downSince !== null && data.active} downSince={downSince} helperSeenAt={data.helper.seenAt ? Date.parse(data.helper.seenAt) : null} helperWakes={data.helper.wakes} serverNow={data.now} onCancel={(id) => void cancel(id)} />
        )}
        {downSince !== null && data && !data.active && <Notice tone="warning" role="status">{S.restarting}</Notice>}
      </div>

      {data && (
        <>
          <UpdatePanel
            version={data.version}
            build={data.build}
            state={data.state}
            last={data.last}
            disabled={blocked}
            needsHelper={helperOff}
            onCheck={() => void quick("check-update")}
            onUpdate={() => setDialog("update")}
            onRollback={() => setDialog("rollback")}
          />
          {/* what the household must act on is said outside the fold: a finding of the status check and each servicing action that failed; the lines and the list are inside */}
          {!helperOff && data.state.doctor?.items.some((i) => i.level !== "ok") && <Notice tone="warning" role="status">{S.doctorFlagged}</Notice>}
          {!helperOff && <ToolFailures last={data.last} />}
          {!helperOff && (
            // the operator's cards (servicing list, status lines, event list) stay folded: the version, the update, the status line and any failure are the page
            <details className="ops-technical">
              <summary>{S.technical}</summary>
              <div className="stack">{panels}</div>
            </details>
          )}
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
          {data?.state.schema_changed && <Notice tone="error" as="p">{S.rollbackSchema}</Notice>}
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
