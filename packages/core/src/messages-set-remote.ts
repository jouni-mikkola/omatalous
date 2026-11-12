/**
 * The catalogue of Asetukset: remote.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_REMOTE = {
  "set.remote.remote_access": "Etäkäyttö",
  "set.remote.loading": "Ladataan…",
  "set.remote.turn_remote_access_off": "Ota etäkäyttö pois käytöstä",
  "set.remote.when_remote_access_is_turned": "Kun otat etäkäytön pois käytöstä, etäosoitteella avattu selain menettää yhteyden.",
  "set.remote.when_remote_access_is_turned_2": "Kun otat etäkäytön pois käytöstä, poistamme osoitteen Cloudflaresta. Sovelluksen oma osoite ei muutu.",
  "set.remote.save_api_token": "Tallenna API-tunniste",
  "set.remote.save": "Tallenna",
  "set.remote.enter_your_password_to_save": "Kirjoita salasanasi, niin tallennamme tunnisteen.",
  "set.remote.remove_api_token": "Poista API-tunniste",
  "set.remote.remove_token": "Poista tunniste",
  "set.remote.check_the_allowed_email_addresses": "Tarkista sallitut sähköpostiosoitteet",
  "set.remote.check_before_turning_on": "Tarkista ennen käyttöönottoa",
  "set.remote.save_list": "Tallenna lista",
  "set.remote.turn_on": "Ota käyttöön",
  "set.remote.turn_off": "Ota pois käytöstä",
  "set.remote.token_field_gone": "Tunnistekenttä ei ole enää näkyvissä. Kirjoita tunniste uudelleen.",
  "set.remote.tick_first": "Merkitse ensin, että ymmärrät sovelluksen vastaavan tämän jälkeen vain palvelimella itsellään.",
} as const;
