/**
 * The catalogue of Asetukset: rform.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_RFORM = {
  "set.rform.enter_the_address_like_talous": "Anna osoite muodossa talous.oma.fi (ilman https://-alkua ja polkua).",
  "set.rform.change_the_allowed_email_addresses": "Muuta sallittuja sähköpostiosoitteita",
  "set.rform.turn_on_remote_access": "Ota etäkäyttö käyttöön",
  "set.rform.save_allowed_addresses": "Tallenna sallitut osoitteet",
  "set.rform.address": "Osoite",
  "set.rform.cannot_change_address": "Osoitetta ei voi vaihtaa. Ota etäkäyttö ensin pois käytöstä.",
  "set.rform.address_help": "Ilman https://-alkua. Osoitteen pitää kuulua tunnisteen verkkotunnukseen, ja verkkotunnuksen edessä saa olla vain yksi osa.",
  "set.rform.allowed_email_addresses": "Sallitut sähköpostiosoitteet",
  "set.rform.one_per_line": "Kirjoita yksi osoite riville. Vain nämä osoitteet voivat kirjautua.",
  "set.rform.removed_still_in": "Poistettu osoite toimii vielä, kunnes sen avoin kirjautuminen päättyy.",
  "set.rform.own_address_listed": "Oman osoitteesi pitää olla listalla.",
} as const;
