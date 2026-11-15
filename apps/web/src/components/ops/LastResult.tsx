import { lastResult } from "./ops-last.ts";
import type { OpsRequestView } from "./types.ts";

/** How an action last ended, under the action itself. An action that never ran has no line. */
export function LastResult({ request, label }: { request: OpsRequestView | undefined; label?: string }) {
  if (!request) return null;
  const { text, tone } = lastResult(request);
  return <div className={`small ${tone === "muted" ? "muted" : ""} ops-last ${tone}`}>{label ? `${label}: ` : ""}{text}</div>;
}
