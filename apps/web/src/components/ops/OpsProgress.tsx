import { useEffect, useState } from "react";
import { dateTime } from "../../format.ts";
import { elapsed, queuedSentence, startTicker } from "./ops-elapsed.ts";
import { S } from "./ops-strings.ts";
import type { OpsRequestView } from "./types.ts";

const RESULT: Record<string, string> = { ok: S.ok, failed: S.failed, expired: S.expired, cancelled: S.cancelled };

/**
 * The newest request: waiting, running (the app may restart meanwhile) or its result with the steps and the
 * log. Everything from the host is shown as text.
 */
export function OpsProgress({ request, down, downSince, helperSeenAt, helperWakes = false, onCancel }: { request: OpsRequestView; down: boolean; downSince: number | null; helperSeenAt: number | null; helperWakes?: boolean; onCancel: (id: string) => void }) {
  // the logs action exists to show its log, so that one opens by itself
  const [log, setLog] = useState(request.action === "logs");
  useEffect(() => setLog(request.action === "logs"), [request.id, request.action]);
  const live = request.status === "queued" || request.status === "running";
  // the clock ticks only while the request is live
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    return startTicker(() => setNow(Date.now()));
  }, [live]);
  const since = Date.parse(request.requestedAt);
  const downMs = downSince ? now - downSince : 0;
  const took = request.finishedAt ? Date.parse(request.finishedAt) - since : null;
  const tone = request.status === "ok" ? "good" : live ? "" : "warning";
  return (
    <div className={`notice ${tone}`} role="status">
      <strong>{request.label.charAt(0).toUpperCase() + request.label.slice(1)}</strong>
      <span className="muted small"> {dateTime(request.requestedAt)}{request.by ? `, ${request.by}` : ""}</span>
      {live && (
        <p style={{ margin: "4px 0" }}>
          {down ? `${S.restarting} ${S.waited(elapsed(downMs))}` : request.status === "queued" ? `${queuedSentence(helperSeenAt, now, helperWakes)} ${S.waited(elapsed(now - since))}` : S.runningFor(elapsed(now - since))}
          {down && downMs > 180_000 && <span> {S.restartingLong}</span>}
        </p>
      )}
      {!live && (
        <p style={{ margin: "4px 0" }}>
          <span className={`badge ${request.status === "ok" ? "good" : "warn"}`} style={{ marginLeft: 0 }}>{RESULT[request.status]}</span> {request.summary}{took !== null && !Number.isNaN(took) && ` ${S.took(elapsed(took))}`}
        </p>
      )}
      {request.steps.length > 0 && (
        <ol className="ops-steps">
          {request.steps.map((s) => (
            <li key={`${s.n}-${s.text}`}><span className="muted">{S.stepNo(s.n, s.m)}</span> <span>{s.text}</span></li>
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
      {log && !live && <pre className="ops-log">{request.output || S.noLog}</pre>}
    </div>
  );
}
