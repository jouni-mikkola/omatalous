/**
 * A saved loan of kind mortgage names the payment series it is paid by (`Loan.seriesKey`). That is the household's own
 * word that the series is its home loan, so the rows of the series are `mortgage`, though the bank row carries only a
 * lender's name and a reference number, which the lender rule reads as consumer credit (`loans`).
 *
 * Only a row that rule left as `loans` moves. A row the household or the run settled (own category, transfer, a return,
 * a payer's role) and any other category of the same payee stay as they are. Nothing here reads a name or an amount
 * alone: the row must be a payment of the saved series (`paysSeries`).
 */
import { paysSeries } from "./loan-detect.ts";
import type { Loan, Transaction } from "./types.ts";

/** The series keys of the saved loans that are the home loan, in a fixed order so two lists compare. */
export function mortgageSeriesKeys(loans: readonly Loan[]): string[] {
  return loans.flatMap((loan) => (loan.kind === "mortgage" && loan.seriesKey ? [loan.seriesKey] : [])).sort();
}

const SETTLED = new Set(["user", "transfer", "match", "payer"]);

/** Reads the rows of the saved home loans' series as `mortgage`. Changes `next` in place; no such loan, no change. */
export function applyDeclaredMortgages(next: readonly Transaction[], locked: ReadonlySet<string>, loans: readonly Loan[] | undefined): void {
  if (!loans?.length) return;
  const keys = mortgageSeriesKeys(loans);
  if (!keys.length) return;
  const others = loans.flatMap((loan) => loan.seriesKey ?? []);
  for (const t of next) {
    if (t.category !== "loans" || t.amountCents >= 0 || t.isTransfer || locked.has(t.id) || SETTLED.has(t.categorySource)) continue;
    if (keys.some((key) => paysSeries(key, t, others))) Object.assign(t, { category: "mortgage", categorySource: "rule" });
  }
}
