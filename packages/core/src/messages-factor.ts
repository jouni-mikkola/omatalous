/**
 * The catalogue of the second factor a public address needs: the refusals of the server. Same shape as the tables of
 * `messages.ts` (a Finnish table gives the codes, the English one must have the same codes and holes) and the same test.
 * Decision: the owner who turns on a public address is told in plain words what is missing and what to do, in the
 * language they chose.
 */
export const FI_FACTOR = {
  "remote.second_factor_needed": "Etäkäyttö vaatii ylläpitäjiltä toisen tekijän. Ota kaksivaiheinen kirjautuminen käyttöön kohdassa Asetukset > Turvallisuus. Puuttuu: {names}.",
  "remote.admin_needs_factor": "Osoite on julkinen, joten ylläpitäjällä pitää olla toinen tekijä. Ota etäkäyttö ensin pois käytöstä tai pyydä jäsentä ottamaan kaksivaiheinen kirjautuminen käyttöön.",
  "factor.keep_while_public": "Osoite on julkinen, joten ylläpitäjällä pitää olla toinen tekijä. Ota etäkäyttö ensin pois käytöstä.",
} as const;
