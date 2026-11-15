import { lastResult } from "./ops-last.ts";
import type { OpsRequestView } from "./types.ts";

/** How an action last ended, under the action itself; nothing for an action nobody has run. */
export function LastResult({ request, label }: { request: OpsRequestView | undefined; label?: string }) {
  const last = lastResult(request);
  if (!last) return null;
  return <div className={`small ${last.tone === "muted" ? "muted" : ""} ops-last ${last.tone}`}>{label ? `${label}: ` : ""}{last.text}</div>;
}
