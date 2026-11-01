/** The English table of set-bapp; the Finnish one it must match is in ../messages-set-bapp.ts. */
import type { FI_SET_BAPP } from "../messages-set-bapp.ts";

export const EN_SET_BAPP: Record<keyof typeof FI_SET_BAPP, string> = {
  "set.bapp.works": "Works. Application ID {id}.",
  "set.bapp.bank_app": "Bank app",
  "set.bapp.application": "Application",
  "set.bapp.household_application": "Household's application",
  "set.bapp.household_in_use": "the household's shared application in use",
  "set.bapp.admin_keeps_it": "The administrator looks after the household's application.",
  "set.bapp.own_application": "Own application",
};
