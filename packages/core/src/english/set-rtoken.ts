/** The English table of set-rtoken; the Finnish one it must match is in ../messages-set-rtoken.ts. */
import type { FI_SET_RTOKEN } from "../messages-set-rtoken.ts";

export const EN_SET_RTOKEN: Record<keyof typeof FI_SET_RTOKEN, string> = {
  "set.rtoken.cloudflare_api_token": "Cloudflare API token",
  "set.rtoken.the_token_is_needed_when": "The token is needed when remote access is turned off.",
  "set.rtoken.replace_token": "Replace token",
  "set.rtoken.remove_token": "Remove token",
  "set.rtoken.the_token_can_be_removed": "The token can be removed when the change is done.",
  "set.rtoken.the_saved_token_can_no": "The saved token can no longer be opened. Save it again.",
  "set.rtoken.save_the_token_first_then": "Save the token first, then remote access can be turned on. The token is not shown after saving.",
  "set.rtoken.api_token": "API token",
  "set.rtoken.save_token": "Save token",
  "set.rtoken.cancel": "Cancel",
  "set.rtoken.saved_at": "Saved {at}.",
};
