import { Balances } from "../pages/Balances.tsx";
import { useShell } from "../shell-context.ts";

/** Varat ja velat; a household with no bank has it too, to add a loan of its own. */
export function BalancesView() {
  const { meta, scope, anchor } = useShell();
  return <Balances meta={meta} scope={scope} anchor={anchor} />;
}
