/**
 * The catalogue of Asetukset: iform.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_IFORM = {
  "set.iform.at_times": "klo {times}",
  "set.iform.no_set_times": "ei kellonaikoja",
  "set.iform.enter_the_address_like_https": "Anna osoite muodossa https://talous.oma.fi (ilman polkua).",
  "set.iform.enter_the_address": "Anna osoite.",
  "set.iform.the_address_is_not_encrypted": "Osoite ei ole salattu (http). Jos sovellukseen pääsee kotiverkon ulkopuolelta, käytä https-osoitetta.",
  "set.iform.no_automatic_fetches": "Ei automaattisia hakuja",
  "set.iform.saving": "Tallennetaan…",
  "set.iform.saved": "Tallennettu.",
  "set.iform.app_address": "Sovelluksen osoite",
  "set.iform.fetches_per_day": "Hakuja päivässä",
  "set.iform.fetch_is_made": "Haemme tapahtumat {when}.",
  "set.iform.fetched_when_opened": "Haemme tapahtumat, kun avaat sovelluksen.",
  "set.iform.look_up_industry": "Hae tuntemattoman kauppiaan toimiala kaupparekisteristä",
  "set.iform.only_the_merchant_name": "Rekisteriin lähtee vain kauppiaan nimi.",
} as const;
