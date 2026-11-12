/** The English table of set-notices; the Finnish one it must match is in ../messages-set-notices.ts. */
import type { FI_SET_NOTICES } from "../messages-set-notices.ts";

export const EN_SET_NOTICES: Record<keyof typeof FI_SET_NOTICES, string> = {
  "set.notices.no_address_given": "No address given.",
  "set.notices.notices_outside_the_browser": "Notices outside the browser",
  "set.notices.state_on": "On.",
  "set.notices.state_off": "Off.",
  "set.notices.a_message_is_sent_when": "A message is sent when a bank consent is about to end, the disk is full, a backup is missing or an update was rolled back. The message has no amounts, account numbers or names.",
  "set.notices.the_server_s_encryption_key": "The server's encryption key is missing, so the address cannot be saved.",
  "set.notices.saving": "Saving…",
  "set.notices.save": "Save",
  "set.notices.remove_token": "Remove token",
  "set.notices.saved": "Saved.",
  "set.notices.place_ntfy": "ntfy topic on server {host}",
  "set.notices.place_url": "address on server {host}",
  "set.notices.saved_place_token": "Saved: {place}, token saved.",
  "set.notices.saved_place": "Saved: {place}.",
  "set.notices.send_notices": "Send notices",
  "set.notices.address_or_ntfy_topic": "Address or ntfy topic",
  "set.notices.address_help": "The https address of a webhook or the name of an ntfy topic (server ntfy.sh).",
  "set.notices.token_optional": "Bearer token (optional)",
};
