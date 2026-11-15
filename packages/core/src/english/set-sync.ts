/** The English table of set-sync; the Finnish one it must match is in ../messages-set-sync.ts. */
import type { FI_SET_SYNC } from "../messages-set-sync.ts";

export const EN_SET_SYNC: Record<keyof typeof FI_SET_SYNC, string> = {
  "set.sync.succeeded": "succeeded",
  "set.sync.partly": "partly",
  "set.sync.failed": "failed",
  "set.sync.running": "running",
  "set.sync.fetches": "Fetches",
  "set.sync.started": "Started",
  "set.sync.how": "How",
  "set.sync.scheduled": "scheduled",
  "set.sync.new_connection": "new connection",
  "set.sync.on_opening_the_app": "on opening the app",
  "set.sync.manual": "manual",
  "set.sync.status": "Status",
  "set.sync.new": "New",
  "set.sync.message": "Message",
  "set.sync.no_bank_connection": "No bank connection",
  "set.sync.automatic_fetch_hours": "Automatic fetch {hours}",
  "set.sync.automatic_fetch_is_off": "Automatic fetch is off",
};
