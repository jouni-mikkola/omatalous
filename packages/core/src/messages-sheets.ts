/**
 * The catalogue of the tax-year sheet in Raportit (Tulot). Same shape as
 * the tables of `messages.ts`: a Finnish table gives the codes, the English one must have the same codes and holes, and
 * the same test holds it. The tax-year words say "rows that may be related" and never "you can deduct".
 * Decision: the household reads in its own language what the sheet lists and what it leaves out.
 */
export const FI_SHEETS = {
  "sheet.print": "Tulosta",
  "sheet.csv": "Lataa CSV",
  "sheet.section": "Osio",
  "sheet.name": "Nimi",
  "sheet.date": "Päivä",
  "sheet.amount": "Summa",
  "sheet.total": "Yhteensä",
  "tax.title": "Verovuoden rivit",
  "tax.question": "Veroilmoituksen rivit",
  "tax.intro": "Tässä ovat vuoden {year} rivit tileiltäsi, jotka voivat liittyä veroilmoitukseesi. Emme anna veroneuvontaa emmekä kerro, mitä voit vähentää. Katso se Verohallinnon ohjeista.",
  "tax.partial": "Vuosi on kesken. Luvut ovat väliltä {from}–{to}.",
  "tax.income": "Tulot lähteittäin",
  "tax.interest": "Lainojen ja luottojen korot",
  "tax.interest_note": "Rivit kategoriasta Korot ja luottokulut. Lainanmaksussa korko ja lyhennys ovat yhdellä rivillä. Niiden jaon näet pankin vuosiyhteenvedosta.",
  "tax.loans": "Lainojen maksut",
  "tax.loans_note": "Maksut yhteensä, korko ja lyhennys yhdessä. Pankin rivi ei kerro, mikä osa on korkoa. Sen näet pankin vuosiyhteenvedosta.",
  "tax.category": "Kategoria",
  "tax.count": "Rivejä",
  "tax.household": "Rivit, jotka voivat liittyä kotitalousvähennykseen",
  "tax.household_note": "Mukana ovat vain kategorian Koti rivit, joiden tekstissä on kodin työhön viittaava sana, kuten siivous, remontti tai sähkötyö. Rivi ei kerro, kuuluuko työ vähennykseen tai kuka sen teki.",
  "tax.refunds": "Veronpalautukset",
  "tax.residual": "Jäännösverot",
  "tax.residual_note": "Rivit kategoriasta Verot, joiden tekstissä on jäännösvero.",
  "tax.csv_name": "verovuosi",
} as const;
