import { FirstRun } from "../pages/FirstRun.tsx";
import { More } from "../pages/reports/More.tsx";
import { useShell } from "../shell-context.ts";

export function ReportsView() {
  const { meta, range, scope, params, anchor, noData, loadDemo, reloadMeta, setReportQuestion } = useShell();
  if (!noData) return <More meta={meta} range={range} scope={scope} params={params} anchor={anchor} onQuestion={setReportQuestion} />;
  return <FirstRun view="reports" onDemo={loadDemo} meta={meta} onReload={reloadMeta} />;
}
