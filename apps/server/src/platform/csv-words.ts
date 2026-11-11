/**
 * The words of the rows file (`GET /api/export/transactions.csv`) in both languages: the heading row, the two states
 * of a row, where a row came from, the transfer mark and the start of the file name. The category and the group of a
 * row are not here: they come from `categoriesIn` of `services/category-names.ts`. The Finnish lines are the bytes the
 * file has always had.
 * Decision: a member who reads English gets a rows file whose every heading and word is English.
 */
import type { Language } from "@banking/core";

type CsvWords = {
  /** The heading row, one cell per column, in the order the route writes the cells of a row. */
  heading: readonly string[];
  pending: string;
  booked: string;
  /** Where a row came from, in the words of the pages: the bank itself, a file the household imported, the example data. */
  sources: Readonly<Record<string, string>>;
  /** The cell of a row that is a transfer. A row that is none has an empty cell. */
  transfer: string;
  /** The start of the file name, before the two dates of the range. */
  fileName: string;
};

const WORDS: Record<Language, CsvWords> = {
  fi: {
    heading: ["Päivä", "Tili", "Kauppias", "Saaja/maksaja", "Viesti", "Kategoria", "Ryhmä", "Summa €", "Tila", "Lähde", "Siirto"],
    pending: "varaus",
    booked: "kirjattu",
    sources: { enablebanking: "pankki", csv: "tiedosto", demo: "esimerkki" },
    transfer: "kyllä",
    fileName: "tapahtumat_",
  },
  en: {
    heading: ["Date", "Account", "Merchant", "Payee/payer", "Message", "Category", "Group", "Amount €", "State", "Source", "Transfer"],
    pending: "pending",
    booked: "booked",
    sources: { enablebanking: "bank", csv: "file", demo: "example" },
    transfer: "yes",
    fileName: "transactions_",
  },
};

export function csvWords(lang: Language): CsvWords {
  return WORDS[lang];
}
