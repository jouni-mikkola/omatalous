import { EmptyStart } from "../components/EmptyStart.tsx";
import { Optimise } from "../pages/Optimise.tsx";
import { useShell } from "../shell-context.ts";

export function OptimiseView() {
  const { meta, scope, noData, loadDemo, reloadMeta } = useShell();
  return noData ? <EmptyStart onDemo={loadDemo} meta={meta} onReload={reloadMeta} /> : <Optimise scope={scope} />;
}
