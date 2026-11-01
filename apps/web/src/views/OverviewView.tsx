import { useShell } from "../shell-context.ts";
import { Overview } from "../pages/Overview.tsx";

export function OverviewView() {
  const { meta, scope, loadDemo, showHousehold, reloadMeta } = useShell();
  return <Overview meta={meta} scope={scope} onEmptyAction={loadDemo} onShowHousehold={showHousehold} onReload={reloadMeta} />;
}
