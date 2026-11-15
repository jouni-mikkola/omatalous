/**
 * Decision: whether the server needs the admin's attention now. One line with the disk;
 * a part that is wrong says so, and the cards below hold the actions.
 */
import { diskItem } from "../../components/ops/ops-last.ts";
import type { OpsState } from "../../components/ops/types.ts";
import { t } from "../../text.ts";

export function ServerStatusLine({ ops }: { ops: OpsState | null }) {
  const disk = ops ? diskItem(ops.state.doctor) : undefined;
  const parts: { label: string; value: string; bad?: boolean }[] = [];
  if (ops) {
    parts.push({ label: t("set.status.disk"), value: disk ? (disk.level === "ok" ? t("set.status.enough") : disk.level === "warn" ? t("set.status.low") : t("set.status.full")) : t("set.status.unknown"), bad: disk !== undefined && disk.level !== "ok" });
  }
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
