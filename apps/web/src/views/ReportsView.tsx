import { EmptyStart } from "../components/EmptyStart.tsx";
import { Reports } from "../pages/Reports.tsx";
import { useShell } from "../shell-context.ts";

export function ReportsView() {
  const { meta, range, scope, params, anchor, noData, loadDemo, reloadMeta, setReportQuestion } = useShell();
  return noData ? <EmptyStart onDemo={loadDemo} meta={meta} onReload={reloadMeta} /> : <Reports meta={meta} range={range} scope={scope} params={params} anchor={anchor} onQuestion={setReportQuestion} />;
}
