import { dateTime } from "../../format.ts";
import { S } from "./ops-strings.ts";
import type { OpsSnapshot } from "./types.ts";

export function UpdatePanel({ version, build, state, disabled, onCheck, onUpdate, onRollback }: {
  version: string;
  build: string;
  state: OpsSnapshot;
  disabled: boolean;
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
            {version} <span className="small">({state.commit ?? build})</span>
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
    </div>
  );
}
