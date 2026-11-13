/**
 * The catalogue of the card statement file (Asetukset > Pankit ja tilit > Tiliote tiedostosta, for a bank file and a card statement) and of the refusals of
 * the route that stores its rows. Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the
 * English one must have the same codes and holes.
 * Decision: the household is told that the file is read in this browser and that only the rows go to the install.
 */
export const FI_CARD_FILE = {
  "card_file.title": "Tiliote tiedostosta",
  "card_file.sub": "Luemme tiedoston selaimessa ja tallennamme vain tapahtumien rivit.",
  "card_file.pick": "Valitse tiedosto",
  "card_file.gap_link": "Tuo kortin tiliote",
  "card_file.gap_note": "Tiedoston rivit tallentuvat vain kortille, jonka teit tiliotteesta, ei pankista haetulle kortille.",
  "card_file.formats": "Tilin CSV-vienti, camt.053-tiliote (XML) tai kortin tiliote (CSV tai teksti)",
  "card_file.reading": "Luetaan…",
  "card_file.err_empty": "Tiedostosta ei löytynyt rivejä.",
  "card_file.err_many": "Tiedostossa on liikaa rivejä: enintään {max} kerralla.",
  "card_file.err_pdf": "Emme lue PDF-tiedostoa. Tuo tiliote CSV- tai tekstitiedostona.",
  "card_file.err_big": "Tiedosto on liian suuri.",
  "card_file.err_save": "Emme saaneet rivejä tallennettua. Yritä uudelleen.",
  "card_file.found": "Löytyi {rows} riviä ajalta {from}–{to}.",
  "card_file.unread_one": "{count} rivi jäi lukematta.",
  "card_file.unread": "{count} riviä jäi lukematta.",
  "card_file.card": "Kortti",
  "card_file.card_new": "Uusi kortti",
  "card_file.name": "Kortin nimi",
  "card_file.save": "Tallenna rivit",
  "card_file.saved": "Tallennettu. Uusia rivejä {inserted}, valmiiksi tallessa olleita {known}.",
  "card_file.col_day": "Päivä",
  "card_file.col_text": "Teksti",
  "card_file.col_sum": "Summa",
  "card_file.caption": "Tiliotteen rivit",
  "card_file.default_name": "Kortti",
  "card_file.skipped": "Ohitettu {count} riviä, jotka pankki oli jo antanut.",
  "card_file.left_out": "Yksi rivi jätettiin pois, koska se on päivätty tulevaisuuteen: {day} {text}.",
  "card_file.left_out_many": "{count} riviä jätettiin pois, koska ne on päivätty tulevaisuuteen. Ensimmäinen: {day} {text}.",
  "card_file.bad_rows": "Tiedoston rivit ovat virheellisiä.",
  "card_file.too_many": "Rivejä on liikaa: enintään {max} kerralla.",
  "card_file.future": "Tiedostossa on tulevaisuuteen päivättyjä rivejä.",
  "card_file.bad_account": "Rivejä ei voi tallentaa tälle tilille.",
  "card_file.on_account": "Suurin osa riveistä on jo tilillä {account}. Valitse tallennuskohteeksi se tili.",
} as const;
