/** The English table of set-wizard; the Finnish one it must match is in ../messages-set-wizard.ts. */
import type { FI_SET_WIZARD } from "../messages-set-wizard.ts";

export const EN_SET_WIZARD: Record<keyof typeof FI_SET_WIZARD, string> = {
  "set.wizard.review": "Review",
  "set.wizard.steps": "Steps",
  "set.wizard.address": "Address",
  "set.wizard.timezone": "Time zone",
  "set.wizard.auto_fetch": "Automatic fetch",
  "set.wizard.not_yet": "not yet",
  "set.wizard.not_active": "not active",
  "set.wizard.configured": "set up",
  "set.wizard.encryption_key": "Encryption key",
  "set.wizard.key_ok": "in order",
  "set.wizard.key_missing": "missing",
  "set.wizard.done_linked": "Done. The bank is connected.",
  "set.wizard.bank_missing": "The bank is still missing. Connect it with the Connect bank button.",
  "set.wizard.app_and_bank_missing": "The Enable Banking app and the bank are still missing. Go back to the previous step.",
  "set.wizard.back": "Back",
  "set.wizard.to_app": "Go to the app",
  "set.wizard.connect_bank": "Connect bank",
  "set.wizard.later": "Do this later",
  "set.wizard.address_not_saved": "We could not save the address: {message} Change it in Settings > Server and maintenance.",
  "set.wizard.title": "Setup",
  "set.wizard.loading": "Loading…",
  "set.wizard.intro": "One app is enough for the whole household. Using your own accounts is free of charge.",
  "set.wizard.where_settings": "You find the address and schedule under Settings > Server and maintenance, and the Enable Banking app under Settings > Banks and accounts.",
  "set.wizard.continue": "Continue",
};
