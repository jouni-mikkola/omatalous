/** Ylläpitoloki on Palvelin ja ylläpito: the newest maintenance events, the rest behind Näytä lisää as in Turvallisuusloki. */
import { Table } from "../table/Table.tsx";
import { Empty } from "../ui/Empty.tsx";
import { dateTime } from "../../format.ts";
import { t } from "../../text.ts";
import { S } from "./ops-strings.ts";
import type { AuditEvent } from "./types.ts";

/** The rows in sight before Näytä lisää: the server sends up to 50 (`opsAudit`), which made the page several screens long. */
const SHOWN = 25;

export function OpsLog({ events }: { events: AuditEvent[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>{S.events}</h2>
      </div>
      {events.length === 0 ? (
        <Empty>{S.noEvents}</Empty>
      ) : (
        <Table
          caption={S.events}
          rows={events}
          rowKey={(e) => String(e.id)}
          page={SHOWN}
          columns={[
            { key: "at", label: t("set.mt.time"), kind: "date", rowHead: true, cell: (e) => dateTime(e.at) },
            { key: "user", label: t("set.mt.user"), kind: "text", cell: (e) => e.username ?? "" },
            { key: "action", label: t("set.mt.action"), kind: "text", cell: (e) => e.action },
            { key: "outcome", label: t("set.mt.result"), kind: "text", cell: (e) => <span className="small">{e.outcome}</span> },
          ]}
        />
      )}
    </div>
  );
}
