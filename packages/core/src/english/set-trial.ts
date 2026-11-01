/** The English table of set-trial; the Finnish one it must match is in ../messages-set-trial.ts. */
import type { FI_SET_TRIAL } from "../messages-set-trial.ts";

export const EN_SET_TRIAL: Record<keyof typeof FI_SET_TRIAL, string> = {
  "set.trial.if_nobody_signs_in_the": "If nobody signs in, the address is closed soon.",
  "set.trial.new_address": "new address",
  "set.trial.the_new_address_did_not": "The new address did not work, so remote access was turned off.",
  "set.trial.check_that_the_email_addresses": "Check that the email addresses are spelled correctly and that the domain's DNS settings in Cloudflare are in order. Then turn remote access on again.",
  "set.trial.when_the_home_network_address": "When the home network address answers again, reload this page.",
  "set.trial.open_link_within": "Open {link} and sign in through Cloudflare within 15 minutes.",
  "set.trial.open_link_once_before": "Open {link} once and sign in through Cloudflare before {time}.",
  "set.trial.trial_ended_open_link": "The trial ended at {time}. If the server has not turned the address off yet, open {link} and sign in through Cloudflare.",
  "set.trial.nobody_got_in_host": "Nobody got in with {host} within 15 minutes. The app answers at the home network address again.",
  "set.trial.nobody_got_in_new": "Nobody got in with the new address within 15 minutes. The app answers at the home network address again.",
  "set.trial.remote_access_is_on_home": "Remote access is on and the home network address no longer answers.",
  "set.trial.open_link_proven": "Open {link} and sign in through Cloudflare.",
  "set.trial.open_link_unproven": "Open {link} and sign in through Cloudflare within 15 minutes.",
};
