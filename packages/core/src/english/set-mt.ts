/** The English table of set-mt; the Finnish one it must match is in ../messages-set-mt.ts. */
import type { FI_SET_MT } from "../messages-set-mt.ts";

export const EN_SET_MT: Record<keyof typeof FI_SET_MT, string> = {
  "set.mt.time": "Time",
  "set.mt.user": "User",
  "set.mt.action": "Action",
  "set.mt.result": "Result",
  "set.mt.loading": "Loading…",
  "set.mt.download": "Download",
};
