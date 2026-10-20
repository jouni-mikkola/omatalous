import { Command } from "./HelperStatus.tsx";
import { S } from "./ops-strings.ts";

interface Props {
  /** Buttons that need the one mutating slot (prune, renew). */
  disabled: boolean;
  /** A read-only request is in flight: logs waits for it. */
  readDisabled: boolean;
  /** The helper knows these actions. */
  supported: boolean;
  enableCommand: string;
  onLogs: () => void;
  onPrune: () => void;
  onRenew: () => void;
}

/** Logs, disk clean-up and helper renewal. None of them takes input, so there is no dialog. */
export function ToolsPanel({ disabled, readDisabled, supported, enableCommand, onLogs, onPrune, onRenew }: Props) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>{S.tools}</h2>
      </div>
      {!supported && (
        <div className="notice warning" role="status">
          {S.toolsOutdated}
          <Command text={enableCommand} />
        </div>
      )}
      <ul className="ops-tools">
        <li>
          <div>
            <strong>{S.logs}</strong>
            <div className="small muted">{S.logsHelp}</div>
          </div>
          <button className="btn" type="button" disabled={readDisabled || !supported} onClick={onLogs}>
            {S.logs}
          </button>
        </li>
        <li>
          <div>
            <strong>{S.prune}</strong>
            <div className="small muted">{S.pruneHelp}</div>
          </div>
          <button className="btn" type="button" disabled={disabled || !supported} onClick={onPrune}>
            {S.prune}
          </button>
        </li>
        <li>
          <div>
            <strong>{S.renew}</strong>
            <div className="small muted">{S.renewHelp}</div>
          </div>
          <button className="btn" type="button" disabled={disabled || !supported} onClick={onRenew}>
            {S.renew}
          </button>
        </li>
      </ul>
    </div>
  );
}
