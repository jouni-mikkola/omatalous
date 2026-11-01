/** The English table of set-ra-model; the Finnish one it must match is in ../messages-set-ra-model.ts. */
import type { FI_SET_RA_MODEL } from "../messages-set-ra-model.ts";

export const EN_SET_RA_MODEL: Record<keyof typeof FI_SET_RA_MODEL, string> = {
  "set.ra.enter_at_least_one_email": "Enter at least one email address that may sign in.",
  "set.ra.there_can_be_at_most": "There can be at most 50 email addresses.",
  "set.ra.change_under_way": "change under way",
  "set.ra.on_trial": "on trial",
  "set.ra.on": "on",
  "set.ra.own_domain": "own domain",
  "set.ra.next_step_wait_for_the": "Next step: wait for the address to be removed from Cloudflare.",
  "set.ra.left_unfinished": "left unfinished",
  "set.ra.off": "off",
  "set.ra.next_step_wait_for_the_2": "Next step: wait for the change to finish.",
  "set.ra.nothing_to_do_your_own": "Nothing to do, your own domain handles access.",
  "set.ra.next_step_open_the_new": "Next step: open the new address once through the Cloudflare sign-in to confirm it.",
  "set.ra.nothing_to_do_change_the": "Nothing to do. Change the allowed addresses or turn remote access off when you need to.",
  "set.ra.next_step_turn_remote_access": "Next step: turn remote access on again or off.",
  "set.ra.next_step_turn_on_the": "Next step: turn on the maintenance helper on the server.",
  "set.ra.next_step_update_the_maintenance": "Next step: update the maintenance helper on the server.",
  "set.ra.next_step_save_the_cloudflare": "Next step: save the Cloudflare token.",
  "set.ra.next_step_save_the_token": "Next step: save the token again, the old one no longer works.",
  "set.ra.next_step_choose_the_address": "Next step: choose the address and the allowed email addresses and turn remote access on.",
  "set.ra.address_n_not_email": "Address {n} is not an email address.",
  "set.ra.sees_one": "It sees the domain {zones}.",
  "set.ra.sees_many": "It sees the domains {zones}.",
  "set.ra.and_last": "{first} and {last}",
  "set.ra.and_others": "{first} and {count} others",
};
