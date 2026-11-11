/**
 * The catalogue of Asetukset: brt.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_BRT = {
  "set.brt.testing": "Testaamme…",
  "set.brt.test_the_return_address": "Testaa paluuosoite",
  "set.brt.the_return_address_works": "Paluuosoite toimii.",
  "set.brt.the_test_failed": "Emme saaneet testiä tehtyä. Yritä uudelleen.",
  "set.brt.return_address": "paluuosoite",
  "set.brt.address_missing": "Osoite puuttuu Redirect URLs -kohdasta: {copy}",
} as const;
