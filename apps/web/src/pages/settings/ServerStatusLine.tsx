/**
 * Decision: whether the server needs the admin's attention now. One line with the newest backup, the disk
 * and remote access; a part that is wrong says so, and the cards below hold the actions.
 */
import { diskItem, newestBackup } from "../../components/ops/ops-last.ts";
import { S } from "../../components/ops/ops-strings.ts";
import type { OpsState } from "../../components/ops/types.ts";
import { dateTime } from "../../format.ts";
import type { RemoteAccessPoll } from "./RemoteAccess.tsx";
import { remoteSummary } from "./remote-access-model.ts";
import { t } from "../../text.ts";

/** A copy older than this is worth a warning: the daily copy has missed a day. */
const STALE_BACKUP_MS = 36 * 3600_000;

export function ServerStatusLine({ ops, remote }: { ops: OpsState | null; remote: RemoteAccessPoll }) {
  const backupAt = ops ? newestBackup([ops.appBackups, ops.state.backups ?? []]) : null;
  const stale = ops && backupAt !== null ? Date.parse(ops.now) - Date.parse(backupAt) > STALE_BACKUP_MS : false;
  const disk = ops ? diskItem(ops.state.doctor) : undefined;
  const parts: { label: string; value: string; bad?: boolean }[] = [];
  if (ops) {
    parts.push({ label: S.backups, value: backupAt ? dateTime(backupAt) : t("set.status.not_yet"), bad: stale || backupAt === null });
    parts.push({ label: t("set.status.disk"), value: disk ? (disk.level === "ok" ? t("set.status.enough") : disk.level === "warn" ? t("set.status.low") : t("set.status.full")) : t("set.status.unknown"), bad: disk !== undefined && disk.level !== "ok" });
  }
  if (remote.data) parts.push({ label: t("set.status.remote_access"), value: remoteSummary(remote.data) });
  if (parts.length === 0) return null;
  return (
    <div className="card server-status" role="status">
      <dl className="server-status-line">
        {parts.map((p) => (
          <div key={p.label} className={p.bad ? "bad" : undefined}>
            <dt>{p.label}</dt>
            <dd>{p.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
