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
  "tax.income": "Income by source",
  "tax.interest": "Interest on loans and credit",
  "tax.loans": "Loan payments",
  "tax.category": "Category",
  "tax.count": "Rows",
  "tax.household": "Rows that may be related to the household credit",
  "tax.refunds": "Tax refunds",
  "tax.residual": "Residual tax",
  "tax.csv_name": "tax-year",
};
