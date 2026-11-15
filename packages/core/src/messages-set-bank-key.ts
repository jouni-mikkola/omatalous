/**
 * The catalogue of Asetukset: bank key.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_BANK_KEY = {
  "set.key.the_file_is_not_a": "Tiedosto ei ole avain.",
  "set.key.own_key_in_use": "käytössä oma avain",
  "set.key.not_set_up": "ei määritetty",
  "set.key.only_if_you_do_not": "Tarvitset tämän vain, jos sinulla on oma Enable Banking -tili. Anna sovelluksen rekisteröinnissä nämä osoitteet:",
  "set.key.the_keys_cannot_be_saved": "Avaimia ei voi nyt tallentaa. Pyydä ylläpitäjää katsomaan palvelimen lokia.",
  "set.key.private_key_as_a_file": "Yksityinen avain tiedostona",
  "set.key.testing": "Testaamme…",
  "set.key.save_and_test": "Tallenna ja testaa",
  "set.key.remove_own_key": "Poista oma avain",
  "set.key.own_key_removed": "Oma avain poistettu.",
} as const;
