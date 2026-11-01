import { dateTime } from "../../format.ts";
import { S } from "./ops-strings.ts";
import { LastResult } from "./LastResult.tsx";
import type { OpsRequestView, OpsSnapshot } from "./types.ts";
import { Button } from "../ui/Button.tsx";
export function UpdatePanel({ version, build, state, last, disabled, prerelease, onCheck, onUpdate, onRollback }: {
  version: string;
  build: string;
  state: OpsSnapshot;
  /** How the check, the update and the rollback last ended. */
  last?: Record<string, OpsRequestView>;
  disabled: boolean;
  /** The switch for new versions and where it stands. Null: no switch (an older helper, a source install). */
  prerelease: { on: boolean; onChange: (on: boolean) => void } | null;
  onCheck: () => void;
  onUpdate: () => void;
  onRollback: () => void;
}) {
  const behind = state.behind_commits ?? [];
  // the switch is two actions, on and off: the newer one tells how the last turn ended
  const turns = [last?.["prerelease-on"], last?.["prerelease-off"]].filter((r): r is OpsRequestView => r !== undefined);
  const switched = turns.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{S.version}</h2>
          <div className="card-sub">
            {/* the build id is for support, so it stays out of sight until asked for */}
            <span title={state.commit ?? build}>{version}</span>
            {state.mode ? ` · ${state.mode}` : ""}
            {state.address ? ` · ${state.address}` : ""}
          </div>
          {state.channel && <div className="card-sub">{S.channel(state.channel)}</div>}
        </div>
        <Button disabled={disabled} onClick={onCheck}>
          {S.checkUpdates}
        </Button>
      </div>
      {state.update_available ? (
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
      ) : (
        // before the first check there is nothing to say: no dash, and with nothing else the head stands alone
        state.checked_at && <p className="muted">{S.upToDate(dateTime(state.checked_at))}</p>
      )}
      {/* each stands only once the action has been run: before that the head stands alone */}
      {(["check-update", "update", "rollback"] as const).map((a) => last?.[a] && <LastResult key={a} label={S.actionNames[a]} request={last[a]} />)}
      {(state.update_available || state.can_rollback) && (
        <div className="form-row">
          {state.update_available && (
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
      {prerelease && (
        // a checkbox with its label and help: the input first, the words and the help beside it, and the whole row is the label
        <div className="setup-form">
          <label className="check">
            <input type="checkbox" role="switch" aria-label={S.prerelease} checked={prerelease.on} disabled={disabled} onChange={(e) => prerelease.onChange(e.target.checked)} />
            <span>
              {S.prerelease}
              <span className="field-help">{S.prereleaseHelp}</span>
              {switched && <LastResult request={switched} />}
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
