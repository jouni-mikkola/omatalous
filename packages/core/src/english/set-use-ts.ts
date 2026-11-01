/** The English table of set-use-ts; the Finnish one it must match is in ../messages-set-use-ts.ts. */
import type { FI_SET_USE_TS } from "../messages-set-use-ts.ts";

export const EN_SET_USE_TS: Record<keyof typeof FI_SET_USE_TS, string> = {
  "set.use.me": "Me",
  "set.use.joint_account": "Joint account",
  "set.use.first_and_last": "{first} and {last}",
  "set.use.balance_before_date": "Balance before {date}",
  "set.use.shared": "Shared",
  "set.use.do_not_know": "Do not know",
  "set.use.person_percent": "{name} {percent}%",
};
