/**
 * The catalogue of Asetukset: rstatus.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_RSTATUS = {
  "set.rstatus.the_connection_to_the_app": "Yhteys sovellukseen katkesi hetkeksi. Sovellus käynnistyy uudelleen muutoksen aikana. Jos et pääse takaisin, avaa se kotiverkon osoitteella.",
  "set.rstatus.cancel_the_change": "Peruuta muutos",
  "set.rstatus.the_list_was_made_on": "Palvelimen asennusohjelma teki listan, eikä se näy täällä.",
  "set.rstatus.this_installation_has_its_own": "Tällä asennuksella on oma verkkotunnus (Caddy), joten etäkäyttöä ei voi ottaa sen rinnalle.",
  "set.rstatus.address": "Osoite",
  "set.rstatus.allowed_email_addresses": "Sallitut sähköpostiosoitteet",
  "set.rstatus.the_app_does_not_check": "Sovellus ei tarkista itse, että kävijä on kirjautunut Cloudflaren kautta.",
  "set.rstatus.remote_access_was_turned_on": "Etäkäyttö on otettu käyttöön palvelimella asennusohjelmalla. Muuta sitä palvelimella komennolla ./scripts/install.sh. Täältä voit ottaa sen pois käytöstä.",
  "set.rstatus.turn_remote_access_on_again": "Ota etäkäyttö uudelleen käyttöön tai ota se pois käytöstä.",
  "set.rstatus.the_last_change_did_not": "Edellinen muutos ei onnistunut.",
  "set.rstatus.change_is_running": "Muutos on käynnissä.",
  "set.rstatus.change_waits_for_helper": "Muutos odottaa ylläpitoapuria.",
  "set.rstatus.turning_on_at": "Otamme etäkäytön käyttöön osoitteessa {host}.",
  "set.rstatus.turning_on": "Otamme etäkäytön käyttöön.",
  "set.rstatus.turning_off": "Poistamme etäkäytön käytöstä.",
  "set.rstatus.page_updates": "Tämä sivu päivittyy, kun muutos on valmis.",
  "set.rstatus.see_maintenance": "Katso Ylläpito",
  "set.rstatus.after_change_open": "Kun muutos on tehty, kotiverkon osoite ei enää vastaa. Avaa silloin {url} ja kirjaudu sisään Cloudflaren kautta 15 minuutin kuluessa.",
  "set.rstatus.new_address_on_trial": "Uusi osoite on kokeilussa.",
  "set.rstatus.remote_access_is_on": "Etäkäyttö on käytössä.",
  "set.rstatus.left_in_cloudflare": "Cloudflaressa on osoite {host}, mutta sovellus ei ole sen takana.",
  "set.rstatus.remote_access_is_off": "Etäkäyttö ei ole käytössä.",
  "set.rstatus.app_address_now": "Sovelluksen osoite on nyt {address}.",
} as const;
