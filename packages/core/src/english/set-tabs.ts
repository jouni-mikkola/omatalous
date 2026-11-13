/** The English table of set-tabs; the Finnish one it must match is in ../messages-set-tabs.ts. */
import type { FI_SET_TABS } from "../messages-set-tabs.ts";

export const EN_SET_TABS: Record<keyof typeof FI_SET_TABS, string> = {
  "set.tab.banks": "Banks and accounts",
  "set.tab.household": "Household",
  "set.tab.members": "Members",
  "set.tab.security": "Security",
  "set.tab.data": "Data",
  "set.tab.server": "Server and maintenance",
  "set.tab.addon": "Add-on",
  "set.tab.nav": "Settings",
};
