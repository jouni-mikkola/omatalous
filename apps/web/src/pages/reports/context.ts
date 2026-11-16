import { type ReportId, spendingLabel } from "@banking/core";
import { query } from "../../api.ts";
import { language } from "../../format.ts";
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
    // a report lists spending, so a card bill is named as Kategoriat names it, whichever report shows it
    label: (id) => {
      const c = meta.categories.find((x) => x.id === id);
      return c ? spendingLabel(c, language()) : id;
    },
    exportHref: (report: ReportId) => `/api/export/report.csv${query({ ...range, scope, report })}`,
    reload,
  };
}
