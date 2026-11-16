/** Asetukset > Pankit ja tilit > Päivitykset: the runs of the bank fetch. */
import { Table } from "../../components/table/Table.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { Meta, SyncRun } from "../../types.ts";
import { syncHoursLabel } from "./InstanceForms.tsx";
import { useReportLoaded } from "./use-settings-page.ts";
import { labelTable, t } from "../../text.ts";

const RUN_STATUS: Record<string, string> = labelTable({ ok: () => t("set.sync.succeeded"), partial: () => t("set.sync.partly"), failed: () => t("set.sync.failed"), running: () => t("set.sync.running") });

/**
 * The latest fetch and every earlier one that did not succeed: a run that found nothing new says nothing, a failed one
 * is what the household looks for. The server sends the 20 newest, newest first. A column with nothing in any row is not
 * drawn; one message brings it back.
 */
export function RunsTable({ runs }: { runs: SyncRun[] }) {
  const shown = runs.filter((r, i) => i === 0 || r.status !== "ok");
  const hasMessage = shown.some((r) => !!r.message);
  return (
    <Table
      caption={t("set.sync.fetches")}
      rows={shown}
      rowKey={(r) => String(r.id)}
      page={10}
      // a few rows are read from the top: a search box finds nothing the eye misses
      search={false}
      columns={[
        { key: "started", label: t("set.sync.started"), kind: "date", rowHead: true, cell: (r) => <span className="run-when">{dateTime(r.startedAt)}</span> },
        { key: "trigger", label: t("set.sync.how"), kind: "text", cell: (r) => <span className="run-when">{r.trigger === "schedule" ? t("set.sync.scheduled") : r.trigger === "connect" ? t("set.sync.new_connection") : r.trigger === "open" || r.trigger === "open-bare" ? t("set.sync.on_opening_the_app") : t("set.sync.manual")}</span> },
        { key: "status", label: t("set.sync.status"), kind: "text", cell: (r) => RUN_STATUS[r.status] ?? r.status },
        { key: "inserted", label: t("set.sync.new"), kind: "count", cell: (r) => r.inserted },
        ...(hasMessage ? [{ key: "message", label: t("set.sync.message"), kind: "text" as const, cell: (r: SyncRun) => <span className="small muted">{r.message ?? ""}</span> }] : []),
      ]}
    />
  );
}

export function SyncRuns({ meta, onLoaded }: { meta: Meta; onLoaded?: (failed?: boolean) => void }) {
  const hasConnection = meta.connections.some((c) => c.status === "active");
  const runs = useApi<{ runs: SyncRun[] }>("/api/sync/runs");
  useReportLoaded(runs.data !== null || runs.error !== null, onLoaded, runs.error !== null);
  // nothing has been fetched: a card that only says so is left out until the first run
  if (runs.data && !runs.data.runs.length) return null;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{t("set.sync.fetches")}</h2>
          <div className="card-sub">
            {!hasConnection
              ? t("set.sync.no_bank_connection")
              : meta.sync.hours.length
                ? t("set.sync.automatic_fetch_hours", { hours: syncHoursLabel(meta.sync.hours) })
                : t("set.sync.automatic_fetch_is_off")}
          </div>
        </div>
      </div>
      {runs.data && runs.data.runs.length > 0 && <RunsTable runs={runs.data.runs} />}
      {runs.error && <Notice tone="error">{runs.error}</Notice>}
    </div>
  );
}
