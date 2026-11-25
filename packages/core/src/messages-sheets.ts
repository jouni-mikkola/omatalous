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
  "tax.none": "Tältä vuodelta ei ole rivejä.",
  "tax.income": "Tulot lähteittäin",
  "tax.interest": "Lainojen ja luottojen korot",
  "tax.loans": "Lainojen maksut",
  "tax.category": "Kategoria",
  "tax.count": "Rivejä",
  "tax.household": "Rivit, jotka voivat liittyä kotitalousvähennykseen",
  "tax.household_total": "Maksut, ei vähennyksen määrä",
  "tax.refunds": "Veronpalautukset",
  "tax.residual": "Jäännösverot",
  "tax.csv_name": "verovuosi",
} as const;
