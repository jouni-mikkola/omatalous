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

/**
 * The words of the three report files (`GET /api/export/report.csv`) in both languages: the three heading rows, the
 * sum row of the month table and the starts of the three file names. The category and the group names are not here:
 * the reports give them in the language they are built with. The Finnish lines are the bytes the files have always had.
 * Decision: a member who reads English gets report files whose every heading and name is English.
 */
type ReportWords = {
  /** The month table: its heading row is `pivotStart`, one cell per month, then `pivotEnd`. */
  pivotStart: readonly string[];
  pivotEnd: readonly string[];
  /** The first cell of the last row of the month table, the sums of the months. */
  sum: string;
  /** The heading rows of the other two files, one cell per column, in the order the route writes the cells of a row. */
  categories: readonly string[];
  cashflow: readonly string[];
  /** The start of each file name, before the two dates of the range. */
  fileNames: Readonly<Record<"pivot" | "categories" | "cashflow", string>>;
};

const REPORT_WORDS: Record<Language, ReportWords> = {
  fi: {
    pivotStart: ["Kategoria", "Ryhmä"],
    pivotEnd: ["Yhteensä €", "Keskiarvo €"],
    sum: "Yhteensä",
    categories: ["Ryhmä", "Kategoria", "Yhteensä €", "Osuus %", "Ostoja", "Keskiostos €", "Keskimäärin kuussa €", "Pienin kuukausi €", "Suurin kuukausi €", "Edellinen jakso €", "Muutos 3 kuukaudessa %"],
    cashflow: ["Kuukausi", "Tulot €", "Kulutus €", "Velanhoito €", "Säästöön €", "Luotonnostot €", "Erotus €", "Säästöaste %", "Tulos €"],
    fileNames: { pivot: "kuukausitaulukko_", categories: "kategoriat_", cashflow: "kassavirta_" },
  },
  en: {
    pivotStart: ["Category", "Group"],
    pivotEnd: ["Total €", "Average €"],
    sum: "Total",
    categories: ["Group", "Category", "Total €", "Share %", "Purchases", "Average purchase €", "Average per month €", "Lowest month €", "Highest month €", "Previous period €", "Change in 3 months %"],
    cashflow: ["Month", "Income €", "Consumption €", "Debt service €", "To savings €", "Credit drawn €", "Difference €", "Savings rate %", "Result €"],
    fileNames: { pivot: "month-table_", categories: "categories_", cashflow: "cashflow_" },
  },
};

export function reportWords(lang: Language): ReportWords {
  return REPORT_WORDS[lang];
}
