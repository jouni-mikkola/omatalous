import { EmptyStart } from "../components/EmptyStart.tsx";
import { Transactions } from "../pages/Transactions.tsx";
import { useShell } from "../shell-context.ts";

export function TransactionsView() {
  const { meta, params, scope, anchor, noData, loadDemo, reloadMeta } = useShell();
  return noData ? <EmptyStart onDemo={loadDemo} meta={meta} onReload={reloadMeta} /> : <Transactions meta={meta} params={params} scope={scope} anchor={anchor} />;
}
