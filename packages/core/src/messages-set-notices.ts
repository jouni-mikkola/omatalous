/**
 * The catalogue of Asetukset: notices.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_NOTICES = {
  "set.notices.no_address_given": "Osoitetta ei ole annettu.",
  "set.notices.notices_outside_the_browser": "Ilmoitukset selaimen ulkopuolelle",
  "set.notices.state_on": "Päällä.",
  "set.notices.state_off": "Ei käytössä.",
  "set.notices.a_message_is_sent_when": "Lähetämme viestin, kun pankkisuostumus on päättymässä, levy on täynnä, varmuuskopio puuttuu tai päivitys on palautettu edelliseen versioon. Viestissä ei ole summia, tilinumeroita eikä nimiä.",
  "set.notices.the_server_s_encryption_key": "Palvelimen salausavain puuttuu, joten osoitetta ei voi tallentaa.",
  "set.notices.saving": "Tallennetaan…",
  "set.notices.save": "Tallenna",
  "set.notices.remove_token": "Poista tunniste",
  "set.notices.saved": "Tallennettu.",
  "set.notices.place_ntfy": "ntfy-aihe palvelimella {host}",
  "set.notices.place_url": "osoite palvelimella {host}",
  "set.notices.saved_place_token": "Tallennettu: {place}, tunniste tallennettu.",
  "set.notices.saved_place": "Tallennettu: {place}.",
  "set.notices.send_notices": "Lähetä ilmoitukset",
  "set.notices.address_or_ntfy_topic": "Osoite tai ntfy-aihe",
  "set.notices.address_help": "Webhookin https-osoite tai ntfy-aiheen nimi (palvelin ntfy.sh).",
  "set.notices.token_optional": "Bearer-tunniste (valinnainen)",
} as const;
