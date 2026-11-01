/**
 * The catalogue of Asetukset: bapp.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_BAPP = {
  "set.bapp.works": "Toimii. Sovelluksen tunnus {id}.",
  "set.bapp.bank_app": "Pankkisovellus",
  "set.bapp.application": "Sovellus",
  "set.bapp.household_application": "Talouden sovellus",
  "set.bapp.household_in_use": "käytössä talouden yhteinen sovellus",
  "set.bapp.admin_keeps_it": "Ylläpitäjä hoitaa talouden sovelluksen.",
  "set.bapp.own_application": "Oma sovellus",
} as const;
