/**
 * The catalogue of Asetukset: the add-on module card (Asetukset > Palvelin > Lisäosa).
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_ADDON = {
  "set.addon.title": "Lisäosa",
  "set.addon.intro": "Lisäosa tuo sovellukseen toiminnon, joka ei kuulu jaettuun koodiin. Saat koodin lisäosan tekijältä. Asennamme vain lisäosan, jonka allekirjoitus täsmää.",
  "set.addon.code": "Syötä lisäosan koodi",
  "set.addon.code_help": "Salaamme koodin emmekä näytä sitä uudelleen.",
  "set.addon.password": "Salasanasi",
  "set.addon.save": "Tallenna koodi",
  "set.addon.saving": "Tallennetaan…",
  "set.addon.remove": "Poista lisäosa",
  "set.addon.removing": "Poistetaan…",
  "set.addon.remove_needs_password": "Kirjoita salasanasi, niin voit poistaa lisäosan.",
  "set.addon.state_none": "Ei yhdistetty.",
  "set.addon.state_connected": "Yhdistetty, versio {version}.",
  "set.addon.state_connected_named": "Yhdistetty: {label}, versio {version}.",
  "set.addon.state_pending": "Versio {version} on ladattu. Se otetaan käyttöön, kun palvelin käynnistyy seuraavan kerran.",
  "set.addon.state_waiting": "Odottaa versiota, joka sopii tähän sovelluksen versioon.",
  "set.addon.state_checking": "Tarkistetaan…",
  "set.addon.state_refused": "Hylätty: {why}.",
  "set.addon.why_signature": "allekirjoitus ei täsmää",
  "set.addon.why_fetch": "julkaisua ei saatu haettua",
  "set.addon.why_code": "koodi ei avaa julkaisuja",
  "set.addon.why_content": "paketin sisältö ei kelpaa",
} as const;
