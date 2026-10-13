import { useState } from "react";
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
        <div className="table-wrap">
          <table className="ruled">
            <thead>
              <tr>
                <th>Nimi</th>
                <th>Aika</th>
                <th>Laji</th>
                <th>Paikka</th>
                <th className="num">Koko</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr key={`${b.where}-${b.name}`}>
                  <td className="small">{b.name}</td>
                  <td>{dateTime(b.at)}</td>
                  <td>{kindLabel(b.kind)}</td>
                  <td>{b.where}</td>
                  <td className="num">{formatSize(b.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
