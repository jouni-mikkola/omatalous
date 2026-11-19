import { More } from "../pages/reports/More.tsx";
import { useShell } from "../shell-context.ts";

/** Raportit; a viewer with no accounts has Varat ja velat alone there, to add a loan of their own. */
export function ReportsView() {
  const { meta, range, scope, params, anchor, noData, setReportQuestion } = useShell();
  return <More meta={meta} range={range} scope={scope} params={params} anchor={anchor} noData={noData} onQuestion={setReportQuestion} />;
}
