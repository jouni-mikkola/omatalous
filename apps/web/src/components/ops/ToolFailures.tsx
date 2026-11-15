import { Notice } from "../ui/Notice.tsx";
import { lastResult } from "./ops-last.ts";
import type { OpsRequestView } from "./types.ts";

/** The servicing actions of the folded list (ToolsPanel). The update, the check and the rollback speak in the Versio card. */
const TOOL_ACTIONS = ["doctor", "logs", "prune", "helper-renew", "restart"];

/**
 * Each servicing action whose last run failed, said outside the fold of the technical details. The last run per action
 * is what counts: a failed renewal stays here when the logs are read after it, and goes when the renewal succeeds.
 */
export function ToolFailures({ last }: { last: Record<string, OpsRequestView> }) {
  const failed = TOOL_ACTIONS.map((a) => last[a]).filter((r): r is OpsRequestView => r !== undefined && r.status === "failed");
  if (failed.length === 0) return null;
  return (
    <>
      {failed.map((r) => (
        <Notice key={r.action} tone="warning" role="status" title={r.label}>
          {lastResult(r).text}
        </Notice>
      ))}
    </>
  );
}
