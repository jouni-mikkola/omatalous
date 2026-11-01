/** The English table of set-rstatus; the Finnish one it must match is in ../messages-set-rstatus.ts. */
import type { FI_SET_RSTATUS } from "../messages-set-rstatus.ts";

export const EN_SET_RSTATUS: Record<keyof typeof FI_SET_RSTATUS, string> = {
  "set.rstatus.the_connection_to_the_app": "The connection to the app dropped for a moment. The app restarts during the change. If you cannot get back, open it at the home network address.",
  "set.rstatus.cancel_the_change": "Cancel the change",
  "set.rstatus.the_list_was_made_on": "The list was made on the server with the installer and is not shown here.",
  "set.rstatus.this_installation_has_its_own": "This installation has its own domain (Caddy), so remote access is not added next to it.",
  "set.rstatus.address": "Address",
  "set.rstatus.allowed_email_addresses": "Allowed email addresses",
  "set.rstatus.the_app_does_not_check": "The app does not check by itself that the visitor signed in through Cloudflare.",
  "set.rstatus.remote_access_was_turned_on": "Remote access was turned on on the server with the installer. Change it on the server with ./scripts/install.sh. You can turn it off here.",
  "set.rstatus.turn_remote_access_on_again": "Turn remote access on again or turn it off.",
  "set.rstatus.the_last_change_did_not": "The last change did not succeed.",
  "set.rstatus.change_is_running": "The change is running.",
  "set.rstatus.change_waits_for_helper": "The change is waiting for the maintenance helper.",
  "set.rstatus.turning_on_at": "Remote access is being turned on at {host}.",
  "set.rstatus.turning_on": "Remote access is being turned on.",
  "set.rstatus.turning_off": "Remote access is being turned off.",
  "set.rstatus.page_updates": "This page updates when the change is done.",
  "set.rstatus.see_maintenance": "See Maintenance",
  "set.rstatus.after_change_open": "When the change is done, the home network address no longer answers. Then open {url} and sign in through Cloudflare within 15 minutes.",
  "set.rstatus.new_address_on_trial": "The new address is on trial.",
  "set.rstatus.remote_access_is_on": "Remote access is on.",
  "set.rstatus.left_in_cloudflare": "Cloudflare has the address {host}, but the app is not behind it.",
  "set.rstatus.remote_access_is_off": "Remote access is off.",
  "set.rstatus.app_address_now": "The app's address is now {address}.",
};
