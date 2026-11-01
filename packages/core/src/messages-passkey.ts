/**
 * The catalogue of passkeys and of the second factor a public address needs: the refusals of the server, the card in
 * Asetukset > Turvallisuus and the passkey step of the sign-in. Same shape as the tables of `messages.ts` (a Finnish
 * table gives the codes, the English one must have the same codes and holes) and the same test.
 * Decision: the owner who turns on a public address, or adds a passkey on a home network address, is told in plain words
 * what is missing and what to do, in the language they chose.
 */
export const FI_PASSKEY = {
  // refusals
  "passkey.needs_https": "Passkey toimii vain https-osoitteessa. Tämän asennuksen osoite on {address}. Ota ensin käyttöön https-osoite, esimerkiksi Etäkäyttö-sivulta.",
  "passkey.start_again": "Aloita passkeyn lisääminen alusta.",
  "passkey.failed": "Passkeyn tarkistus ei onnistunut. Avaa sovellus osoitteessa {address} ja yritä uudelleen.",
  "passkey.sign_in_failed": "Passkey ei kelvannut. Yritä uudelleen tai käytä koodia.",
  "passkey.too_many": "Passkeyja voi olla enintään {max}.",
  "passkey.label_bad": "Anna laitteelle nimi, enintään {max} merkkiä.",
  "passkey.taken": "Tämä passkey on jo lisätty.",
  "passkey.none": "Tunnuksella ei ole passkeyta.",
  "passkey.unknown": "Passkeyta ei löydy.",
  "remote.second_factor_needed": "Etäkäyttö vaatii ylläpitäjiltä toisen tekijän. Ota kaksivaiheinen kirjautuminen tai passkey käyttöön kohdassa Asetukset > Turvallisuus. Puuttuu: {names}. Passkey kelpaa vain osoitteelle, jolle se on tehty.",
  "remote.admin_needs_factor": "Osoite on julkinen, joten ylläpitäjällä pitää olla toinen tekijä. Ota etäkäyttö ensin pois käytöstä tai pyydä jäsentä ottamaan kaksivaiheinen kirjautuminen käyttöön.",
  "factor.keep_while_public": "Osoite on julkinen, joten ylläpitäjällä pitää olla toinen tekijä. Ota etäkäyttö ensin pois käytöstä.",
  // the card
  "passkey.title": "Passkey (pääsyavain)",
  "passkey.intro": "Passkey on toinen tekijä salasanan rinnalla. Se on tallennettu laitteeseesi, ja laite kysyy kirjautuessa sormenjälkeä, kasvoja tai lukituksen avausta.",
  "passkey.https_note": "Passkey toimii vain https-osoitteessa. Tämän asennuksen osoite on {address}, joten passkeyta ei voi lisätä. Kotiverkossa ilman https:ää käytä kaksivaiheista kirjautumista sovelluksella.",
  "passkey.empty": "Passkeyta ei ole lisätty.",
  "passkey.add": "Lisää passkey",
  "passkey.device": "Laitteen nimi",
  "passkey.password": "Salasana",
  "passkey.code": "Koodi sovelluksesta tai palautuskoodi",
  "passkey.added": "Lisätty {date}",
  "passkey.used": "viimeksi käytetty {date}",
  "passkey.unused": "ei vielä käytetty",
  "passkey.remove": "Poista",
  "passkey.remove_named": "Poista passkey {name}",
  "passkey.unsupported": "Tämä selain ei tue passkeyta.",
  "passkey.cancelled": "Passkeyn luonti keskeytyi.",
  // the sign-in
  "login.passkey": "Käytä passkeyta",
  "login.passkey_waiting": "Odotamme laitetta",
  "login.passkey_intro": "Vahvista kirjautuminen passkeylla tai anna koodi.",
  "login.passkey_cancelled": "Passkeyn käyttö keskeytyi. Yritä uudelleen tai käytä koodia.",
} as const;
