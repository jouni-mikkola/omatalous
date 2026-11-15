import { Command } from "./HelperStatus.tsx";
import { LastResult } from "./LastResult.tsx";
import { S } from "./ops-strings.ts";
import type { OpsRequestView } from "./types.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
interface Props {
  /** Buttons that need the one mutating slot (prune, renew, restart). */
  disabled: boolean;
  /** A read-only request is in flight: the status and the logs wait for it. */
  readDisabled: boolean;
  /** The helper knows logs, prune and renew; the status and the restart every helper knows. */
  supported: boolean;
  enableCommand: string;
  /** How each action last ended, by action name; one that never ran has no entry and no line. */
  last: Record<string, OpsRequestView>;
  onDoctor: () => void;
  onLogs: () => void;
  onPrune: () => void;
  onRenew: () => void;
  onRestart: () => void;
}

/** The servicing actions as one list: status, logs, disk clean-up, helper renewal and restart. None of them takes input, so there is no dialog. */
export function ToolsPanel({ disabled, readDisabled, supported, enableCommand, last, onDoctor, onLogs, onPrune, onRenew, onRestart }: Props) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>{S.tools}</h2>
      </div>
      {!supported && (
        <Notice tone="warning" role="status">
          {S.toolsOutdated}
          <Command text={enableCommand} />
        </Notice>
      )}
      <ul className="ops-tools">
        <li>
          <div>
            <strong>{S.doctor}</strong>
            <LastResult request={last["doctor"]} />
          </div>
          <Button disabled={readDisabled} onClick={onDoctor}>
            {S.runDoctor}
          </Button>
        </li>
        <li>
          <div>
            <strong>{S.logs}</strong>
            <div className="small muted">{S.logsHelp}</div>
            <LastResult request={last["logs"]} />
          </div>
          <Button disabled={readDisabled || !supported} onClick={onLogs}>
            {S.logs}
          </Button>
        </li>
        <li>
          <div>
            <strong>{S.prune}</strong>
            <div className="small muted">{S.pruneHelp}</div>
            <LastResult request={last["prune"]} />
          </div>
          <Button disabled={disabled || !supported} onClick={onPrune}>
            {S.prune}
          </Button>
        </li>
        <li>
          <div>
            <strong>{S.renew}</strong>
            <div className="small muted">{S.renewHelp}</div>
            <LastResult request={last["helper-renew"]} />
          </div>
          <Button disabled={disabled || !supported} onClick={onRenew}>
            {S.renew}
          </Button>
        </li>
        <li>
          <div>
            <strong>{S.restart}</strong>
            <div className="small muted">{S.restartHelp}</div>
            <LastResult request={last["restart"]} />
          </div>
          <Button disabled={disabled} onClick={onRestart}>
            {S.restart}
          </Button>
        </li>
      </ul>
    </div>
  );
}
