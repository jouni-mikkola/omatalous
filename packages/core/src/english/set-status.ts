/** The English table of set-status; the Finnish one it must match is in ../messages-set-status.ts. */
import type { FI_SET_STATUS } from "../messages-set-status.ts";

export const EN_SET_STATUS: Record<keyof typeof FI_SET_STATUS, string> = {
  "set.status.not_yet": "not yet",
  "set.status.disk": "Disk",
  "set.status.enough": "enough",
  "set.status.low": "low",
  "set.status.full": "full",
  "set.status.unknown": "unknown",
  "set.status.remote_access": "Remote access",
};
