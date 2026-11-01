/** The English table of set-bank-key; the Finnish one it must match is in ../messages-set-bank-key.ts. */
import type { FI_SET_BANK_KEY } from "../messages-set-bank-key.ts";

export const EN_SET_BANK_KEY: Record<keyof typeof FI_SET_BANK_KEY, string> = {
  "set.key.the_file_is_not_a": "The file is not a key.",
  "set.key.own_key_in_use": "own key in use",
  "set.key.not_set_up": "not set up",
  "set.key.only_if_you_do_not": "Only if you do not use the shared application. The Enable Banking registration form asks for these addresses:",
  "set.key.the_keys_cannot_be_saved": "The keys cannot be saved now. Ask the administrator to look at the server log.",
  "set.key.private_key_as_a_file": "Private key as a file",
  "set.key.testing": "Testing…",
  "set.key.save_and_test": "Save and test",
  "set.key.remove_own_key": "Remove own key",
  "set.key.own_key_removed": "Own key removed.",
};
