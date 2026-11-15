/** The English table of sheets; the Finnish one it must match is in ../messages-sheets.ts. */
import type { FI_SHEETS } from "../messages-sheets.ts";

export const EN_SHEETS: Record<keyof typeof FI_SHEETS, string> = {
  "sheet.print": "Print",
  "sheet.csv": "Download CSV",
  "sheet.section": "Part",
  "sheet.name": "Name",
  "sheet.date": "Date",
  "sheet.amount": "Amount",
  "sheet.total": "Total",
  "tax.title": "Tax-year rows",
  "tax.question": "Rows for the tax return",
  "tax.intro": "Rows of the accounts for {year} that may be related to the tax return. This is not tax advice and does not say what can be deducted: the tax authority's guidance does.",
  "tax.partial": "The year is not over. The figures cover {from} to {to}.",
  "tax.income": "Income by source",
  "tax.interest": "Interest on loans and credit",
  "tax.interest_note": "Rows of the category Interest and credit costs. A loan payment holds interest and principal in one row, so their split shows only in the bank's annual statement.",
  "tax.loans": "Loan payments",
  "tax.loans_note": "Payments in all, interest and principal together. The bank's row does not say which part is interest: the bank's annual statement does.",
  "tax.category": "Category",
  "tax.count": "Rows",
  "tax.household": "Rows that may be related to the household credit",
  "tax.household_note": "Only rows of the Home category whose text holds a word for work in a home, such as cleaning, renovation or electrical work. A row does not say whether the work qualifies or who did it.",
  "tax.refunds": "Tax refunds",
  "tax.residual": "Residual tax",
  "tax.residual_note": "Rows of the Taxes category whose text says residual tax.",
  "tax.csv_name": "tax-year",
};
