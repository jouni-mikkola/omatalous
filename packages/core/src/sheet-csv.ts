// Decision: the household takes a sheet to a spreadsheet or an accountant with the same figures the page shows
import { type CsvCell, csv } from "./csv.ts";
import type { FI_SHEETS } from "./messages-sheets.ts";
import type { TaxYearReport } from "./reports/tax-year.ts";

/** The sheets' words in the language the reader asked for. */
type Say = (code: keyof typeof FI_SHEETS, params?: Record<string, string | number>) => string;

const euros = (cents: number | null): number | null => (cents === null ? null : Math.round(cents) / 100);

/** The tax-year sheet as one file: a part, a name, a date and an amount in euros on every line. */
export function taxYearCsv(r: TaxYearReport, say: Say, label: (category: string) => string): string {
  const lines: CsvCell[][] = [[say("sheet.section"), say("sheet.name"), say("sheet.date"), say("sheet.amount")]];
  const part = (title: string, rows: readonly { name: string; date: string; cents: number }[]) => rows.forEach((x) => lines.push([title, x.name, x.date, euros(x.cents)]));
  lines.push([say("tax.intro", { year: r.year }), null, null, null]);
  for (const t of r.income.types) lines.push([say("tax.income"), t.label, null, euros(t.totalCents)]);
  lines.push([say("tax.income"), say("sheet.total"), null, euros(r.income.totalCents)]);
  part(say("tax.refunds"), r.refunds.rows);
  part(say("tax.interest"), r.interest.rows);
  for (const p of r.loanPayments) lines.push([say("tax.loans"), label(p.category), null, euros(p.cents)]);
  part(say("tax.household"), r.household.rows);
  part(say("tax.residual"), r.residual.rows);
  return csv(lines);
}
