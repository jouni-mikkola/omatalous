import { S } from "./ops-strings.ts";
import { LastResult } from "./LastResult.tsx";
import type { OpsRequestView, OpsSnapshot } from "./types.ts";
import { Button } from "../ui/Button.tsx";
/** What the Versio line leaves out: the install's mode, address and update channel. Shown in the fold of technical details. */
export function VersionFacts({ state }: { state: OpsSnapshot }) {
  const mode = [state.mode, state.address].filter(Boolean).join(" · ");
  if (!mode && !state.channel) return null;
  return (
    <div className="card">
      {mode && <div className="card-sub">{mode}</div>}
      {state.channel && <div className="card-sub">{S.channel(state.channel)}</div>}
    </div>
  );
}

export function UpdatePanel({ version, build, state, last, disabled, needsHelper = false, onCheck, onUpdate, onRollback }: {
  version: string;
  build: string;
  state: OpsSnapshot;
  /** How the check, the update and the rollback last ended. */
  last?: Record<string, OpsRequestView>;
  disabled: boolean;
  /** The buttons are off because the helper is not in use: the button says so itself, as the notice is in another card. */
  needsHelper?: boolean;
  onCheck: () => void;
  onUpdate: () => void;
  onRollback: () => void;
}) {
  const behind = state.behind_commits ?? [];
  // commits waiting are an offer whatever update_available says: the page never calls an install up to date that is behind
  const offered = state.update_available === true || behind.length > 0;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{S.version}</h2>
          <div className="card-sub">
            {/* the build id is for support, so it stays out of sight until asked for */}
            <span title={state.commit ?? build}>{version}</span>
            {!offered && state.checked_at ? `, ${S.upToDate}` : ""}
          </div>
        </div>
        <div className="form-row settings-flush">
          {needsHelper && (
            <span className="muted small" id="update-needs-helper">
              {S.needsHelper}
            </span>
          )}
          <Button disabled={disabled} onClick={onCheck} aria-describedby={needsHelper ? "update-needs-helper" : undefined}>
            {S.checkUpdates}
          </Button>
        </div>
      </div>
      {offered ? (
        <>
          <p>
            <strong>{S.updateAvailable(state.latest_version)}</strong>
          </p>
          {behind.length > 0 && (
            <>
              <div className="field-label">{S.changes}</div>
              <ul className="ops-commits">
                {behind.map((c) => (
                  <li key={c.hash}>
                    <code>{c.hash}</code> {c.subject}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : null}
      {/* each stands only once the action has been run: before that the head stands alone */}
      {(["check-update", "update", "rollback"] as const).map((a) => last?.[a] && <LastResult key={a} label={S.actionNames[a]} request={last[a]} />)}
      {(offered || state.can_rollback) && (
        <div className="form-row">
          {offered && (
            <Button variant="primary" disabled={disabled} onClick={onUpdate}>
              {S.update}
            </Button>
          )}
          {state.can_rollback && (
            <Button disabled={disabled} onClick={onRollback}>
              {S.rollback}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
