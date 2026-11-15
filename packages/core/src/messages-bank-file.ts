/**
 * The catalogue of the bank CSV file (Asetukset > Pankit ja tilit > Pankin CSV-tiedosto). The rows it finds, its
 * refusals and its buttons reuse the codes of the card statement file (`messages-card-file.ts`). Same shape as the
 * other tables: the English one must have the same codes.
 * Decision: the household is told that the file is read in this browser, that only the rows go to the install and that the columns are matched once.
 */
export const FI_BANK_FILE = {
  "bank_file.err_table": "Tiedosto ei ole CSV-taulukko.",
  "bank_file.columns": "Sarakkeet",
  "bank_file.remembered": "Muistamme sarakkeet tämän pankin tiedostoille.",
  "bank_file.need": "Valitse päivän, tekstin ja summan sarakkeet, niin rivit näkyvät.",
  "bank_file.none": "Ei valittu",
  "bank_file.col_date": "Päivän sarake",
  "bank_file.col_text": "Tekstin sarake",
  "bank_file.col_message": "Viestin sarake",
  "bank_file.col_amount": "Summan sarake",
  "bank_file.col_debit": "Veloituksen sarake",
  "bank_file.col_credit": "Hyvityksen sarake",
  "bank_file.split": "Veloitus ja hyvitys ovat eri sarakkeissa",
  "bank_file.account": "Tili",
  "bank_file.account_new": "Uusi tili",
  "bank_file.account_connected": "{name} (pankkiyhteys)",
  "bank_file.name": "Tilin nimi",
  "bank_file.err_camt": "Tiedosto ei ole camt.053-tiliote.",
  "bank_file.err_camt_currency": "Tiedostossa on muuta kuin euroja. Voimme lukea vain euromääräiset tiliotteet.",
  "bank_file.err_camt_accounts": "Tiedostossa on usean tilin tiliotteita. Lue yhden tilin tiedosto kerrallaan.",
  "bank_file.err_camt_balance": "Tiedostossa ei ole avaavaa ja päättävää saldoa, joten emme voi tarkistaa rivejä.",
  "bank_file.err_camt_mismatch": "Emme ottaneet tiedostoa: päättävä saldo {closing} ei täsmää riveihin. Avaava saldo {opening} ja rivit antavat {expected}, erotus on {difference}.",
  "bank_file.default_name": "Nimi, esim. Käyttötili",
  "bank_file.err_camt_entry": "Tiedostossa on kirjattu tapahtuma, jonka päivä, summa tai teksti puuttuu. Emme ota tiedostoa, koska rivejä jäisi pois.",
} as const;
