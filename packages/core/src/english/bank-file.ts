/** The English table of bank-file; the Finnish one it must match is in ../messages-bank-file.ts. */
import type { FI_BANK_FILE } from "../messages-bank-file.ts";

export const EN_BANK_FILE: Record<keyof typeof FI_BANK_FILE, string> = {
  "bank_file.err_table": "The file is not a CSV table.",
  "bank_file.columns": "Columns",
  "bank_file.remembered": "The columns are remembered for this bank's files.",
  "bank_file.need": "Choose the columns of the day, the text and the amount to see the rows.",
  "bank_file.none": "Not chosen",
  "bank_file.col_date": "Day column",
  "bank_file.col_text": "Text column",
  "bank_file.col_amount": "Amount column",
  "bank_file.col_debit": "Debit column",
  "bank_file.col_credit": "Credit column",
  "bank_file.split": "Debit and credit are in separate columns",
  "bank_file.account": "Account",
  "bank_file.account_new": "New account",
  "bank_file.name": "Account name",
  "bank_file.err_camt": "The file is not a camt.053 statement.",
  "bank_file.err_camt_currency": "The file holds something other than euros. Only statements in euros are read.",
  "bank_file.err_camt_accounts": "The file has statements of several accounts. Read one account's file at a time.",
  "bank_file.err_camt_balance": "The file has no opening and closing balance, so the rows cannot be checked.",
  "bank_file.err_camt_mismatch": "The file was refused: the closing balance {closing} does not match the rows. The opening balance {opening} and the rows give {expected}, a difference of {difference}.",
  "bank_file.default_name": "Name, e.g. Current account",
  "bank_file.err_camt_entry": "The file has a booked entry with no day, amount or text. The file is not taken, because rows would be left out.",
};
