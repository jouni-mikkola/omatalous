/** Asetukset > Palvelin: the views nobody in the household has opened for a quarter, with the day they were last opened. */
// Decision: which reports, observations and tips to drop (the owner confirms it after a quarter on the real install)
import { addDays } from "@banking/core";
import { FoldCard } from "../../components/ui/FoldCard.tsx";
import { Table } from "../../components/table/Table.tsx";
import { Empty } from "../../components/ui/Empty.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { date } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { REPORT_SECTIONS } from "../reports/registry.ts";
import { t } from "../../text.ts";

interface Answer {
  since: string | null;
  today: string;
  days: number;
  views: { view: string; lastDay: string }[];
  opened: string[];
}

interface Row {
  view: string;
  kind: "report" | "insight" | "finding";
  name: string;
  lastDay: string | null;
}

const KIND_ORDER = { report: 0, insight: 1, finding: 2 } as const;

function rowOf(view: string, lastDay: string | null): Row {
  const kind = view.slice(0, view.indexOf(":")) as Row["kind"];
  const rest = view.slice(view.indexOf(":") + 1);
  const title = kind === "report" ? REPORT_SECTIONS.find((s) => s.id === rest)?.title : undefined;
  return { view, kind, name: title ?? rest, lastDay };
}

/** The views to list: those last opened before the edge, and the report sections never opened once tracking is a quarter old. */
export function listed(a: Answer): Row[] {
  const rows = a.views.map((v) => rowOf(v.view, v.lastDay));
  if (a.since !== null && a.since <= addDays(a.today, -a.days)) {
    const known = new Set(a.opened);
    for (const s of REPORT_SECTIONS) if ((s.page === "reports" || s.page === "settings") && !known.has(`report:${s.id}`)) rows.push(rowOf(`report:${s.id}`, null));
  }
  return rows.sort((x, y) => (x.lastDay ?? "").localeCompare(y.lastDay ?? "") || KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || x.name.localeCompare(y.name));
}

export function UnopenedViews() {
  const { data, error } = useApi<Answer>("/api/admin/unopened-views");
  const rows = data ? listed(data) : [];
  return (
    <FoldCard title={t("views.title")} sub={t("views.sub", { days: data?.days ?? 90 })} folded={rows.length === 0}>
      {error && <Notice tone="warning">{error}</Notice>}
      {data && rows.length > 0 && (
        <Table
          caption={t("views.caption")}
          rows={rows}
          rowKey={(r) => r.view}
          columns={[
            { key: "name", label: t("views.col_view"), kind: "text", rowHead: true, cell: (r) => r.name },
            { key: "kind", label: t("views.col_kind"), kind: "text", cell: (r) => t(`views.kind_${r.kind}`) },
            { key: "last", label: t("views.col_last"), kind: "date", cell: (r) => (r.lastDay ? date(r.lastDay) : t("views.never")) },
          ]}
        />
      )}
      {data && rows.length === 0 && (
        <Empty>
          {data.since === null
            ? t("views.not_started")
            : data.since > addDays(data.today, -data.days)
              ? t("views.young", { date: date(data.since), days: data.days })
              : t("views.none", { days: data.days })}
        </Empty>
      )}
    </FoldCard>
  );
}
