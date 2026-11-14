import { t } from "../../text.ts";
import { useState } from "react";
import { Table } from "../table/Table.tsx";
import { dateTime } from "../../format.ts";
import { formatSize, kindLabel, restorable, restoreWait, S } from "./ops-strings.ts";
import { LastResult } from "./LastResult.tsx";
import { PasswordDialog } from "./PasswordDialog.tsx";
import type { Backup, OpsRequestView, RestoreCopy } from "./types.ts";
import { useRestore } from "./use-restore.ts";
import { Button } from "../ui/Button.tsx";
import { Empty } from "../ui/Empty.tsx";
import { Notice } from "../ui/Notice.tsx";
/** The newest copies shown before the rest open. */
const SHOWN = 5;

/**
 * Decision: the admin can take the newest intact copy back after a mistake, knowing which copy it is and what is lost.
 * The row of that copy has "Palauta"; the dialog names the copy's time, because the newest copy may have been made
 * after the mistake. The server picks the copy, so no other row offers it.
 */
export function BackupList({ app, host, disabled, restoreDisabled, canDownload, last, onBackup, onDownload }: {
  app: Backup[];
  host: Backup[];
  disabled: boolean;
  restoreDisabled: boolean;
  canDownload: boolean;
  /** How the backup action last ended. */
  last?: OpsRequestView;
  onBackup: () => void;
  onDownload: () => void;
}) {
  const [all, setAll] = useState(false);
  const [ask, setAsk] = useState(false);
  const restore = useRestore(app.map((b) => b.name).join());
  const copy = restorable(restore.state);
  const rows = [...app.map((b) => ({ ...b, where: "sovellus" })), ...host.map((b) => ({ ...b, where: "kone" }))].sort((a, b) => b.at.localeCompare(a.at));
  const shown = all ? rows : rows.slice(0, SHOWN);
  const restoring = restore.asked;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{S.backups}</h2>
          <div className="card-sub">{S.keyNote}</div>
          {/* `last` is only the copy taken by hand: with copies in the list, "not run yet" would say there are none */}
          {(last || rows.length === 0) && <LastResult request={last} />}
        </div>
        <div className="form-row flush">
          <Button disabled={disabled} onClick={onBackup}>
            {S.backupNow}
          </Button>
          <Button disabled={!canDownload} onClick={onDownload}>
            {S.downloadNewest}
          </Button>
        </div>
      </div>
      {restore.error && !restore.state && <Notice tone="error">{restore.error}</Notice>}
      {restore.state?.pending && !restoring && <p>{S.restorePending}</p>}
      {restoring && <RestoreStatus copy={restoring} back={restore.back} waited={restore.waited} stillPending={restore.stillPending} />}
      {rows.length === 0 ? (
        <Empty>{S.noBackups}</Empty>
      ) : (
        <Table
          caption={S.backups}
          rows={shown}
          rowKey={(b) => `${b.where}-${b.name}`}
          columns={[
            { key: "name", label: t("ops.col_name"), kind: "text", rowHead: true, cell: (b) => <span className="small">{b.name}</span> },
            { key: "at", label: t("ops.col_time"), kind: "date", cell: (b) => dateTime(b.at) },
            { key: "kind", label: t("ops.col_kind"), kind: "text", cell: (b) => kindLabel(b.kind) },
            { key: "where", label: t("ops.col_place"), kind: "text", cell: (b) => (b.where === "sovellus" ? t("ops.place_app") : t("ops.place_host")) },
            { key: "size", label: t("ops.col_size"), kind: "count", cell: (b) => formatSize(b.size) },
            {
              key: "restore",
              label: t("ops.col_actions"),
              headHidden: true,
              kind: "count",
              cell: (b) =>
                copy && b.where === "sovellus" && b.name === copy.name && !restoring ? (
                  <Button variant="link" disabled={restoreDisabled} aria-label={`${S.restoreRow} ${b.name}`} onClick={() => setAsk(true)}>
                    {S.restoreRow}
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      {rows.length > SHOWN && (
        <div className="form-row">
          <span className="cut-mark">
            1–{shown.length} / {rows.length}
          </span>
          <Button onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? t("ops.show_fewer") : t("ops.show_more", { n: rows.length - shown.length })}
          </Button>
        </div>
      )}
      {ask && copy && (
        <PasswordDialog
          title={S.restoreTitle}
          submitLabel={S.restoreSubmit}
          confirmWord={S.restoreWord}
          danger
          onCancel={() => setAsk(false)}
          onSubmit={async (password, confirm) => {
            await restore.send(password, confirm);
            setAsk(false);
          }}
        >
          <p>
            {copy.name} · {formatSize(copy.size)}
          </p>
          <ul>
            {S.restoreDialog(dateTime(copy.at)).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>{S.restoreLoses}</p>
          <p>{copy.kind === "pre-reset" ? S.restoreUndoesReset : S.restoreMistake}</p>
        </PasswordDialog>
      )}
    </div>
  );
}

/** After the request: what is waited for, and when the app answers again, the button that loads the page. */
export function RestoreStatus({ copy, back, waited, stillPending }: { copy: RestoreCopy; back: boolean; waited: number; stillPending: boolean | null }) {
  return (
    <div role="status">
      <p>{S.restoreAsked(dateTime(copy.at))}</p>
      {back ? (
        stillPending !== null && (
          <>
            <p>{stillPending ? S.restoreStillPending : S.restoreBack}</p>
            <div className="form-row">
              <Button variant="primary" onClick={() => window.location.reload()}>
                {S.reload}
              </Button>
            </div>
          </>
        )
      ) : (
        restoreWait(waited).map((line) => <p key={line}>{line}</p>)
      )}
    </div>
  );
}
