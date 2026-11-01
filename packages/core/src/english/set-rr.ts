/** The English table of set-rr; the Finnish one it must match is in ../messages-set-rr.ts. */
import type { FI_SET_RR } from "../messages-set-rr.ts";

export const EN_SET_RR: Record<keyof typeof FI_SET_RR, string> = {
  "set.rr.renew_them_in_one_round": "Renew them in one round: one connection at a time, and here you see which are done.",
  "set.rr.renew_all_connections": "Renew all connections",
  "set.rr.close": "Close",
  "set.rr.end_the_round": "End the round",
  "set.rr.renewing_connections": "Renewing connections",
  "set.rr.renew_label": "Renew {label}",
  "set.rr.renewed": "renewed",
  "set.rr.waiting": "waiting",
};
