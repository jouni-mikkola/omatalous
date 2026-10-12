import { dateTime } from "../../format.ts";
import { S } from "./ops-strings.ts";
import type { OpsSnapshot } from "./types.ts";

export function UpdatePanel({ version, build, state, disabled, prerelease, onCheck, onUpdate, onRollback }: {
  version: string;
  build: string;
  state: OpsSnapshot;
  disabled: boolean;
  /** The switch for new versions and where it stands. Null: no switch (an older helper, a source install). */
  prerelease: { on: boolean; onChange: (on: boolean) => void } | null;
  onCheck: () => void;
  onUpdate: () => void;
  onRollback: () => void;
}) {
  const behind = state.behind_commits ?? [];
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
        </div>
        <button className="btn" type="button" disabled={disabled} onClick={onCheck}>
          {S.checkUpdates}
        </button>
      </div>
      {state.update_available ? (
        <>
          <p>
            <strong>{S.updateAvailable}</strong>
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
        <p className="muted">{state.checked_at ? S.upToDate(dateTime(state.checked_at)) : S.notChecked}</p>
      )}
      <div className="form-row">
        {state.update_available && (
          <button className="btn btn-primary" type="button" disabled={disabled} onClick={onUpdate}>
            {S.update}
          </button>
        )}
        {state.can_rollback && (
          <button className="btn btn-danger" type="button" disabled={disabled} onClick={onRollback}>
            {S.rollback}
          </button>
        )}
      </div>
      {prerelease && (
        // drawn as Features.tsx draws a checkbox with its label and help: the input first, the words and the help beside it, and the whole row is the label
        <div className="setup-form">
          <label className="check">
            <input type="checkbox" role="switch" aria-label={S.prerelease} checked={prerelease.on} disabled={disabled} onChange={(e) => prerelease.onChange(e.target.checked)} />
            <span>
              {S.prerelease}
              <span className="field-help">{S.prereleaseHelp}</span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
