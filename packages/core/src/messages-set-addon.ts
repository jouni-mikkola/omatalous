/**
 * The catalogue of Asetukset: the add-on module card (Asetukset > Lisäosa, or Palvelin ja ylläpito while no module is loaded).
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_ADDON = {
  "set.addon.title": "Lisäosa",
  "set.addon.code": "Syötä lisäosan koodi",
  "set.addon.password": "Salasanasi",
  "set.addon.save": "Tallenna koodi",
  "set.addon.saving": "Tallennetaan…",
  "set.addon.check": "Tarkista päivitys",
  "set.addon.checking": "Tarkistetaan…",
  "set.addon.found_restart": "Uusin versio {version} on ladattu. Käynnistä palvelin uudelleen, niin se tulee käyttöön.",
  "set.addon.found_running": "Uusin versio {version} on jo käytössä.",
  "set.addon.found_none": "Tarkistus ei asentanut mitään. Tilanne on kortin otsikossa.",
  "set.addon.remove": "Poista lisäosa",
  "set.addon.removing": "Poistetaan…",
  "set.addon.remove_needs_password": "Kirjoita salasanasi, niin voit poistaa lisäosan.",
  "set.addon.state_none": "Ei yhdistetty.",
  "set.addon.state_connected": "Yhdistetty, versio {version}.",
  "set.addon.state_connected_named": "Yhdistetty: {label}, versio {version}.",
  "set.addon.state_no_code": "Käytössä, versio {version}. Koodia ei ole tallennettu, joten uusia versioita ei haeta.",
  "set.addon.state_no_code_named": "Käytössä: {label}, versio {version}. Koodia ei ole tallennettu, joten uusia versioita ei haeta.",
  "set.addon.state_pending": "Lataus onnistui: versio {version}. Palvelin ottaa sen käyttöön seuraavassa käynnistyksessä.",
  "set.addon.state_waiting": "Odottaa versiota, joka sopii tähän sovelluksen versioon.",
  "set.addon.state_checking": "Tarkistetaan…",
  "set.addon.state_refused": "Hylätty: {why}.",
  "set.addon.why_signature": "allekirjoitus ei täsmää",
  "set.addon.why_fetch": "julkaisua ei saatu haettua",
  "set.addon.why_code": "koodi ei avaa julkaisuja",
  "set.addon.why_content": "paketin sisältö ei kelpaa",
  "set.addon.why_migration": "lisäosan tietokantamuutos epäonnistui, joten palvelin käynnistyi ilman sitä",
} as const;
