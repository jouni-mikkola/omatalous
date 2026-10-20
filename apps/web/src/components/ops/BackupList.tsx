import { useState } from "react";
import { DataTable } from "../table/DataTable.tsx";
import { dateTime } from "../../format.ts";
import { formatSize, kindLabel, S } from "./ops-strings.ts";
import type { Backup } from "./types.ts";

/** The newest copies shown before the rest open. */
const SHOWN = 5;

export function BackupList({ app, host, disabled, canDownload, onBackup, onDownload }: {
  app: Backup[];
  host: Backup[];
  disabled: boolean;
  canDownload: boolean;
  onBackup: () => void;
  onDownload: () => void;
}) {
  const [all, setAll] = useState(false);
  const rows = [...app.map((b) => ({ ...b, where: "sovellus" })), ...host.map((b) => ({ ...b, where: "kone" }))].sort((a, b) => b.at.localeCompare(a.at));
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{S.backups}</h2>
          <div className="card-sub">{S.keyNote}</div>
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <button className="btn" type="button" disabled={disabled} onClick={onBackup}>
            {S.backupNow}
          </button>
          <button className="btn" type="button" disabled={!canDownload} onClick={onDownload}>
            {S.downloadNewest}
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty">{S.noBackups}</div>
      ) : (
        <DataTable
          id="backups"
          caption={S.backups}
          rows={shown}
          rowKey={(b) => `${b.where}-${b.name}`}
          phone="cards"
          columns={[
            { key: "name", label: "Nimi", kind: "text", rowHead: true, cell: (b) => <span className="small">{b.name}</span> },
            { key: "at", label: "Aika", kind: "date", cell: (b) => dateTime(b.at) },
            { key: "kind", label: "Laji", kind: "text", cell: (b) => kindLabel(b.kind) },
            { key: "where", label: "Paikka", kind: "text", cell: (b) => b.where },
            { key: "size", label: "Koko", kind: "count", cell: (b) => formatSize(b.size) },
          ]}
        />
      )}
      {rows.length > SHOWN && (
        <div className="form-row">
          <span className="cut-mark">
            1–{shown.length} / {rows.length}
          </span>
          <button className="btn btn-small" type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? "Näytä vähemmän" : "Näytä lisää"}
          </button>
        </div>
      )}
    </div>
  );
}
