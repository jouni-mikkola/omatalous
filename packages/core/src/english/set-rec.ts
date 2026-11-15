/** The English table of set-rec; the Finnish one it must match is in ../messages-set-rec.ts. */
import type { FI_SET_REC } from "../messages-set-rec.ts";

export const EN_SET_REC: Record<keyof typeof FI_SET_REC, string> = {
  "set.rec.matches_2": "matches",
  "set.rec.cannot_check_yet": "The balance cannot be checked against the bank's data yet: {reason}",
};
