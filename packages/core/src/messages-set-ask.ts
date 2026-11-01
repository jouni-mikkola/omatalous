/**
 * The catalogue of Asetukset: ask.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_ASK = {
  "set.ask.this_change_has_no_trial": "Tällä muutoksella ei ole kokeiluaikaa. Lista on voimassa heti, ja jos oma sähköpostiosoitteesi puuttuu siitä, et pääse enää sisään.",
  "set.ask.the_removed_address_still_lets": "Poistettu osoite toimii vielä, kunnes sen kirjautuminen Cloudflaressa vanhenee.",
  "set.ask.remote_access_will_be_turned": "Otamme etäkäytön käyttöön tällä osoitteella ja näille sähköpostiosoitteille.",
  "set.ask.address": "Osoite",
  "set.ask.email_addresses": "Sähköpostiosoitteet",
  "set.ask.the_new_address_is_first": "Kokeilemme uutta osoitetta ensin. Avaa se 15 minuutin kuluessa ja kirjaudu Cloudflaren kautta jollakin listan osoitteella. Jos kukaan ei pääse sisään, palvelin poistaa etäkäytön itse käytöstä.",
  "set.ask.make_sure_your_own_email": "Varmista, että oma sähköpostiosoitteesi on listalla ja että kirjoitit osoitteet oikein. Sovellus käynnistyy muutoksen aikana uudelleen.",
  "set.ask.the_maintenance_helper_does_not": "Ylläpitoapuri ei näytä uutta osoitetta täällä. Näet sen palvelimella.",
  "set.ask.the_address_is_removed_from": "Poistamme osoitteen Cloudflaresta. Sovelluksen oma osoite ei muutu.",
  "set.ask.a_browser_opened_with_the": "Etäosoitteella avattu selain menettää yhteyden.",
  "set.ask.i_understand_this_and_want": "Ymmärrän tämän ja haluan ottaa etäkäytön pois käytöstä.",
  "set.ask.the_api_token_is_removed": "Poistamme API-tunnisteen palvelimelta. Voit muuttaa etäkäyttöä vasta, kun tallennat tunnisteen uudelleen.",
  "set.ask.only_these_can_sign_in": "Osoitteessa {url} voit kirjautua vain näillä sähköpostiosoitteilla:",
  "set.ask.when_on_home_stops": "Kun etäkäyttö on päällä, kotiverkon osoite ei enää vastaa. Pääset sovellukseen vain osoitteella {url}.",
  "set.ask.afterwards_found_at": "Tämän jälkeen Omatalous löytyy osoitteesta {after}.",
  "set.ask.afterwards_server_only": "Tämän jälkeen Omatalous vastaa vain palvelimella itsellään, osoitteessa {after}. Kotiverkon muut laitteet eivät pääse siihen.",
  "set.ask.cloudflare_settings_need_token": "Cloudflaren asetuksia (osoite {host}) ei voi poistaa ilman API-tunnistetta. Ota etäkäyttö ensin pois käytöstä.",
} as const;
