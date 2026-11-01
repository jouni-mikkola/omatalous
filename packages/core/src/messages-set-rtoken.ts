/**
 * The catalogue of Asetukset: rtoken.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_RTOKEN = {
  "set.rtoken.cloudflare_api_token": "Cloudflaren API-tunniste (API Token)",
  "set.rtoken.the_token_is_needed_when": "Tarvitset tunnisteen, kun otat etäkäytön pois käytöstä.",
  "set.rtoken.replace_token": "Vaihda tunniste",
  "set.rtoken.remove_token": "Poista tunniste",
  "set.rtoken.the_token_can_be_removed": "Voit poistaa tunnisteen, kun muutos on valmis.",
  "set.rtoken.the_saved_token_can_no": "Tallennettua tunnistetta ei voi enää avata. Tallenna se uudelleen.",
  "set.rtoken.save_the_token_first_then": "Tallenna tunniste ensin, niin voit ottaa etäkäytön käyttöön. Emme näytä tunnistetta tallennuksen jälkeen.",
  "set.rtoken.api_token": "API-tunniste",
  "set.rtoken.save_token": "Tallenna tunniste",
  "set.rtoken.cancel": "Peruuta",
  "set.rtoken.saved_at": "Tallennettu {at}.",
} as const;
