/**
 * The catalogue of the first-run setup page.
 * Decision: the household reads the setup in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_WIZARD = {
  "set.wizard.review": "Tarkistus",
  "set.wizard.steps": "Vaiheet",
  "set.wizard.address": "Osoite",
  "set.wizard.timezone": "Aikavyöhyke",
  "set.wizard.auto_fetch": "Automaattinen haku",
  "set.wizard.not_yet": "ei vielä",
  "set.wizard.not_active": "ei käytössä",
  "set.wizard.configured": "määritetty",
  "set.wizard.encryption_key": "Salausavain",
  "set.wizard.key_ok": "kunnossa",
  "set.wizard.key_missing": "puuttuu",
  "set.wizard.done_linked": "Valmis. Pankki on yhdistetty.",
  "set.wizard.bank_missing": "Pankki puuttuu vielä. Yhdistä se painikkeesta Yhdistä pankki.",
  "set.wizard.app_and_bank_missing": "Enable Banking -sovellus ja pankki puuttuvat vielä. Palaa edelliseen vaiheeseen.",
  "set.wizard.back": "Takaisin",
  "set.wizard.to_app": "Siirry sovellukseen",
  "set.wizard.connect_bank": "Yhdistä pankki",
  "set.wizard.later": "Tee myöhemmin",
  "set.wizard.address_not_saved": "Emme voineet tallentaa osoitetta: {message} Muuta se kohdassa Asetukset > Palvelin.",
  "set.wizard.title": "Käyttöönotto",
  "set.wizard.loading": "Ladataan…",
  "set.wizard.intro": "Yksi sovellus riittää koko taloudelle. Omien tilien käyttö on maksutonta.",
  "set.wizard.where_settings": "Osoitteen ja aikataulun löydät kohdasta Asetukset > Palvelin, Enable Banking -sovelluksen kohdasta Asetukset > Pankit ja tilit.",
  "set.wizard.continue": "Jatka",
} as const;
