import type { ReportId } from "@banking/core";
import { query } from "../../api.ts";
import type { Meta, ReportsData, Scope } from "../../types.ts";
import type { ReportContext, ReportRange } from "./types.ts";

/** The context every section of a page reads, built once per answer of `/api/reports`. */
export function reportContext(data: ReportsData, meta: Meta, range: ReportRange, scope: Scope, reload?: () => void): ReportContext {
  return {
    data,
    meta,
    range,
    scope,
    // the month that has not ended yet, marked in the tables
    running: range.to >= meta.today ? meta.today.slice(0, 7) : null,
    label: (id) => meta.categories.find((c) => c.id === id)?.label ?? id,
    exportHref: (report: ReportId) => `/api/export/report.csv${query({ ...range, scope, report })}`,
    reload,
  };
}
