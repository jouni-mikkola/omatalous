import { useState } from "react";
import { dateTime } from "../../format.ts";
import { S } from "./ops-strings.ts";
import type { OpsRequestView } from "./types.ts";

const RESULT: Record<string, string> = { ok: S.ok, failed: S.failed, expired: S.expired, cancelled: S.cancelled };

/**
 * The newest request: waiting, running (the app may restart meanwhile) or its result with the steps and the
 * log. Everything from the host is shown as text.
 */
export function OpsProgress({ request, down, downMs, onCancel }: { request: OpsRequestView; down: boolean; downMs: number; onCancel: (id: string) => void }) {
  const [log, setLog] = useState(false);
  const live = request.status === "queued" || request.status === "running";
  const tone = request.status === "ok" ? "good" : live ? "" : "warning";
  return (
    <div className={`notice ${tone}`} role="status">
      <strong>{request.label.charAt(0).toUpperCase() + request.label.slice(1)}</strong>
      <span className="muted small"> {dateTime(request.requestedAt)}{request.by ? `, ${request.by}` : ""}</span>
      {live && (
        <p style={{ margin: "4px 0" }}>
          {down ? S.restarting : request.status === "queued" ? S.queued : S.running}
          {down && downMs > 180_000 && <span> {S.restartingLong}</span>}
        </p>
      )}
      {!live && (
        <p style={{ margin: "4px 0" }}>
          <span className={`badge ${request.status === "ok" ? "good" : "warn"}`} style={{ marginLeft: 0 }}>{RESULT[request.status]}</span> {request.summary}
        </p>
      )}
      {request.steps.length > 0 && (
        <ol className="ops-steps">
          {request.steps.map((s) => (
            <li key={`${s.n}-${s.text}`}>{s.text}</li>
          ))}
        </ol>
      )}
      <div className="form-row">
        {request.status === "queued" && (
          <button className="btn btn-small" type="button" onClick={() => onCancel(request.id)}>
            {S.cancelRequest}
          </button>
        )}
        {!live && (
          <button className="btn btn-small" type="button" aria-expanded={log} onClick={() => setLog(!log)}>
            {log ? S.hideLog : S.showLog}
          </button>
        )}
      </div>
      {log && <pre className="ops-log">{request.output || S.noLog}</pre>}
    </div>
  );
}
