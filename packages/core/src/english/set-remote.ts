/** The English table of set-remote; the Finnish one it must match is in ../messages-set-remote.ts. */
import type { FI_SET_REMOTE } from "../messages-set-remote.ts";

export const EN_SET_REMOTE: Record<keyof typeof FI_SET_REMOTE, string> = {
  "set.remote.remote_access": "Remote access",
  "set.remote.remote_access_lets_you_reach": "Remote access lets you reach the app from outside the home network.",
  "set.remote.loading": "Loading…",
  "set.remote.turn_remote_access_off": "Turn remote access off",
  "set.remote.when_remote_access_is_turned": "When remote access is turned off, a browser opened with the remote address loses its connection.",
  "set.remote.when_remote_access_is_turned_2": "When remote access is turned off, the address is removed from Cloudflare. The app's own address does not change.",
  "set.remote.save_api_token": "Save API token",
  "set.remote.save": "Save",
  "set.remote.enter_your_password_to_save": "Enter your password to save the token.",
  "set.remote.remove_api_token": "Remove API token",
  "set.remote.remove_token": "Remove token",
  "set.remote.check_the_allowed_email_addresses": "Check the allowed email addresses",
  "set.remote.check_before_turning_on": "Check before turning on",
  "set.remote.save_list": "Save list",
  "set.remote.turn_on": "Turn on",
  "set.remote.turn_off": "Turn off",
  "set.remote.token_field_gone": "The token field is no longer visible. Enter the token again.",
  "set.remote.tick_first": "First tick that you understand the app will afterwards answer only on the server itself.",
};
