/**
 * The catalogue of Asetukset: ra model.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_RA_MODEL = {
  "set.ra.enter_at_least_one_email": "Anna vähintään yksi sähköpostiosoite, jolla voi kirjautua.",
  "set.ra.there_can_be_at_most": "Sähköpostiosoitteita voi olla enintään 50.",
  "set.ra.change_under_way": "muutos kesken",
  "set.ra.on_trial": "kokeilussa",
  "set.ra.on": "päällä",
  "set.ra.own_domain": "oma verkkotunnus",
  "set.ra.next_step_wait_for_the": "Odota, että osoite poistuu Cloudflaresta.",
  "set.ra.left_unfinished": "jäänyt kesken",
  "set.ra.off": "pois käytöstä",
  "set.ra.next_step_wait_for_the_2": "Odota, että muutos valmistuu.",
  "set.ra.nothing_to_do_your_own": "Ei tehtävää, oma verkkotunnus hoitaa pääsyn.",
  "set.ra.next_step_open_the_new": "Avaa uusi osoite kerran Cloudflaren kirjautumisen kautta, niin se vahvistuu.",
  "set.ra.nothing_to_do_change_the": "Ei tehtävää. Muuta sallittuja osoitteita tai ota etäkäyttö pois, kun tarvitset.",
  "set.ra.next_step_turn_remote_access": "Ota etäkäyttö uudelleen käyttöön tai pois käytöstä.",
  "set.ra.next_step_turn_on_the": "Ota ylläpitoapuri käyttöön palvelimella.",
  "set.ra.next_step_update_the_maintenance": "Päivitä ylläpitoapuri palvelimella.",
  "set.ra.next_step_save_the_cloudflare": "Tallenna Cloudflaren tunniste.",
  "set.ra.next_step_save_the_token": "Tallenna tunniste uudelleen, vanha ei enää toimi.",
  "set.ra.next_step_choose_the_address": "Valitse osoite ja sallitut sähköpostiosoitteet ja ota etäkäyttö käyttöön.",
  "set.ra.address_n_not_email": "Osoite {n} ei ole sähköpostiosoite.",
  "set.ra.sees_one": "Se näkee verkkotunnuksen {zones}.",
  "set.ra.sees_many": "Se näkee verkkotunnukset {zones}.",
  "set.ra.and_last": "{first} ja {last}",
  "set.ra.and_others": "{first} ja {count} muuta",
} as const;
