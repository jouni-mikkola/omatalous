import { EmptyStart } from "../components/EmptyStart.tsx";
import { Bills } from "../pages/Bills.tsx";
import { useShell } from "../shell-context.ts";

export function BillsView() {
  const { meta, scope, noData, loadDemo, reloadMeta } = useShell();
  return noData ? <EmptyStart onDemo={loadDemo} meta={meta} onReload={reloadMeta} /> : <Bills meta={meta} scope={scope} />;
}
