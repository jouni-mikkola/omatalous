/** The English table of set-rform; the Finnish one it must match is in ../messages-set-rform.ts. */
import type { FI_SET_RFORM } from "../messages-set-rform.ts";

export const EN_SET_RFORM: Record<keyof typeof FI_SET_RFORM, string> = {
  "set.rform.enter_the_address_like_talous": "Enter the address like talous.oma.fi (without https:// and a path).",
  "set.rform.change_the_allowed_email_addresses": "Change the allowed email addresses",
  "set.rform.turn_on_remote_access": "Turn on remote access",
  "set.rform.save_allowed_addresses": "Save allowed addresses",
  "set.rform.address": "Address",
  "set.rform.cannot_change_address": "The address cannot be changed. Turn remote access off first.",
  "set.rform.address_help": "Without https://. The address must belong to the token's domain, and only one part may come before the domain.",
  "set.rform.allowed_email_addresses": "Allowed email addresses",
  "set.rform.one_per_line": "One address per line. Only these addresses can sign in.",
  "set.rform.removed_still_in": "A removed address can still get in until its open sign-in ends.",
  "set.rform.own_address_listed": "Your own address must be on the list.",
};
