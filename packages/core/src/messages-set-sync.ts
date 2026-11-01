/**
 * The catalogue of Asetukset: sync.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_SYNC = {
  "set.sync.succeeded": "onnistui",
  "set.sync.partly": "osittain",
  "set.sync.failed": "epäonnistui",
  "set.sync.running": "käynnissä",
  "set.sync.fetches": "Pankkihaut",
  "set.sync.started": "Aloitettu",
  "set.sync.how": "Tapa",
  "set.sync.scheduled": "ajastettu",
  "set.sync.new_connection": "uusi yhteys",
  "set.sync.on_opening_the_app": "sovelluksen avaus",
  "set.sync.manual": "käsin",
  "set.sync.status": "Tila",
  "set.sync.new": "Uusia",
  "set.sync.message": "Viesti",
  "set.sync.no_bank_connection": "Ei pankkiyhteyttä",
  "set.sync.automatic_fetch_hours": "Automaattinen haku {hours}",
  "set.sync.automatic_fetch_is_off": "Automaattinen haku ei ole käytössä",
} as const;
