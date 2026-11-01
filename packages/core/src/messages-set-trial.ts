/**
 * The catalogue of Asetukset: trial.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_TRIAL = {
  "set.trial.if_nobody_signs_in_the": "Jos kukaan ei kirjaudu sisään, suljemme osoitteen pian.",
  "set.trial.new_address": "uusi osoite",
  "set.trial.the_new_address_did_not": "Uusi osoite ei toiminut, joten poistimme etäkäytön käytöstä.",
  "set.trial.check_that_the_email_addresses": "Tarkista, että kirjoitit sähköpostiosoitteet oikein ja että verkkotunnuksen DNS-asetukset ovat Cloudflaressa kunnossa. Ota sitten etäkäyttö uudelleen käyttöön.",
  "set.trial.when_the_home_network_address": "Kun kotiverkon osoite vastaa taas, lataa tämä sivu uudelleen.",
  "set.trial.open_link_within": "Avaa {link} ja kirjaudu sisään Cloudflaren kautta 15 minuutin kuluessa.",
  "set.trial.open_link_once_before": "Avaa {link} kerran ja kirjaudu sisään Cloudflaren kautta ennen kello {time}.",
  "set.trial.trial_ended_open_link": "Kokeiluaika päättyi kello {time}. Jos palvelin ei ole vielä ottanut osoitetta pois käytöstä, avaa {link} ja kirjaudu sisään Cloudflaren kautta.",
  "set.trial.nobody_got_in_host": "Osoitteella {host} kukaan ei päässyt sisään 15 minuutissa. Sovellus vastaa taas kotiverkon osoitteessa.",
  "set.trial.nobody_got_in_new": "Uudella osoitteella kukaan ei päässyt sisään 15 minuutissa. Sovellus vastaa taas kotiverkon osoitteessa.",
  "set.trial.remote_access_is_on_home": "Etäkäyttö on otettu käyttöön, eikä kotiverkon osoite enää vastaa.",
  "set.trial.open_link_proven": "Avaa {link} ja kirjaudu sisään Cloudflaren kautta.",
  "set.trial.open_link_unproven": "Avaa {link} ja kirjaudu sisään Cloudflaren kautta 15 minuutin kuluessa.",
} as const;
