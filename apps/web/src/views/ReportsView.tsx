import { EmptyStart } from "../components/EmptyStart.tsx";
import { FirstRun } from "../pages/FirstRun.tsx";
import { isMonth, More } from "../pages/reports/More.tsx";
import { useShell } from "../shell-context.ts";

export function ReportsView() {
  const { meta, range, scope, params, anchor, noData, loadDemo, reloadMeta, setReportQuestion } = useShell();
  if (!noData) return <More meta={meta} range={range} scope={scope} params={params} anchor={anchor} onQuestion={setReportQuestion} />;
  // the bare address is the Kuukausi tab; a page of Lisää keeps the start card alone
  return isMonth(params, anchor) ? <FirstRun view="reports" onDemo={loadDemo} meta={meta} onReload={reloadMeta} /> : <EmptyStart onDemo={loadDemo} meta={meta} onReload={reloadMeta} />;
}
