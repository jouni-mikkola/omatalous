/** The English table of set-ask; the Finnish one it must match is in ../messages-set-ask.ts. */
import type { FI_SET_ASK } from "../messages-set-ask.ts";

export const EN_SET_ASK: Record<keyof typeof FI_SET_ASK, string> = {
  "set.ask.this_change_has_no_trial": "This change has no trial period. The list applies at once, and if your own email address is missing from it, you can no longer sign in.",
  "set.ask.the_removed_address_still_lets": "The removed address still lets people in until its sign-in at Cloudflare expires.",
  "set.ask.remote_access_will_be_turned": "Remote access will be turned on with this address and these email addresses.",
  "set.ask.address": "Address",
  "set.ask.email_addresses": "Email addresses",
  "set.ask.the_new_address_is_first": "The new address is first on trial. Open it within 15 minutes and sign in through Cloudflare with one of the addresses on the list. If nobody gets in, the server turns remote access off by itself.",
  "set.ask.make_sure_your_own_email": "Make sure your own email address is on the list and that the addresses are spelled correctly. The app restarts during the change.",
  "set.ask.the_maintenance_helper_does_not": "The maintenance helper does not show the new address here. You can see it on the server.",
  "set.ask.the_address_is_removed_from": "The address is removed from Cloudflare. The app's own address does not change.",
  "set.ask.a_browser_opened_with_the": "A browser opened with the remote address loses its connection.",
  "set.ask.i_understand_this_and_want": "I understand this and want to turn remote access off.",
  "set.ask.the_api_token_is_removed": "The API token is removed from the server. You cannot change remote access until you save the token again.",
  "set.ask.only_these_can_sign_in": "Only these email addresses can sign in at {url}:",
  "set.ask.when_on_home_stops": "When remote access is on, the home network address no longer answers. The app can only be reached at {url}.",
  "set.ask.afterwards_found_at": "Afterwards Omatalous is found at {after}.",
  "set.ask.afterwards_server_only": "Afterwards Omatalous answers only on the server itself, at {after}. Other devices on the home network cannot reach it.",
  "set.ask.cloudflare_settings_need_token": "Cloudflare settings (address {host}) cannot be removed without the API token. Turn remote access off first.",
};
