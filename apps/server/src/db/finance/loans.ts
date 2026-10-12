/** Loans the user typed in and confirmed. Own rows only: sharing an account shares no loan. */
import { LOAN_KINDS, LOAN_REFERENCES, LOAN_REPAYMENTS, type Loan, notLoanKey, notLoanMark, renamedMarkSubject } from "@banking/core";
import { num, type Row, str } from "../rows.ts";
import type { Statement } from "../types.ts";
import type { FinanceContext } from "./context.ts";

/** The columns a loan's own fields go to, in the order of `values`. */
const COLUMNS = [
  "name",
  "lender",
  "kind",
  "granted_cents",
  "balance_cents",
  "balance_date",
  "rate_bp",
  "reference",
  "margin_bp",
  "repayment",
  "interval_months",
  "payment_cents",
  "end_date",
  "limit_cents",
  "series_key",
] as const;

const values = (l: Loan) => [
  l.name,
  l.lender,
  l.kind,
  l.grantedCents,
  l.balanceCents,
  l.balanceDate,
  l.rateBp,
  l.reference,
  l.marginBp,
  l.repayment,
  l.intervalMonths,
  l.paymentCents,
  l.endDate,
  l.limitCents,
  l.seriesKey,
];

/** A value of one of core's lists. A row a newer version wrote may hold one this code does not know: that is null. */
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly unknown[]).includes(v) ? (v as T) : null);

const toLoan = (r: Row): Loan => ({
  id: String(r.id),
  name: String(r.name),
  lender: str(r.lender),
  // no figure depends on the kind, so an unknown one reads as the catch-all
  kind: oneOf(LOAN_KINDS, r.kind) ?? "other",
  grantedCents: num(r.granted_cents),
  balanceCents: Number(r.balance_cents),
  balanceDate: String(r.balance_date),
  rateBp: num(r.rate_bp),
  reference: oneOf(LOAN_REFERENCES, r.reference),
  marginBp: num(r.margin_bp),
  repayment: oneOf(LOAN_REPAYMENTS, r.repayment),
  intervalMonths: num(r.interval_months),
  paymentCents: num(r.payment_cents),
  endDate: str(r.end_date),
  limitCents: num(r.limit_cents),
  seriesKey: str(r.series_key),
});

export class LoansRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /** The user's loans in the order they were added. */
  async listLoans(): Promise<Loan[]> {
    return (await this.ctx.db.all<Row>("SELECT * FROM loans WHERE user_id = ? ORDER BY created_at, rowid", [this.ctx.userId])).map(toLoan);
  }

  async addLoan(loan: Loan, at: string): Promise<void> {
    await this.ctx.db.run(`INSERT INTO loans (id, user_id, ${COLUMNS.join(", ")}, created_at, updated_at) VALUES (?, ?, ${COLUMNS.map(() => "?").join(", ")}, ?, ?)`, [
      loan.id,
      this.ctx.userId,
      ...values(loan),
      at,
      at,
    ]);
  }

  /** Replaces every field of the user's loan. False when the user has no such loan, whoever else may. */
  async updateLoan(loan: Loan, at: string): Promise<boolean> {
    const set = COLUMNS.map((c) => `${c} = ?`).join(", ");
    return (await this.ctx.db.run(`UPDATE loans SET ${set}, updated_at = ? WHERE user_id = ? AND id = ?`, [...values(loan), at, this.ctx.userId, loan.id])).changes > 0;
  }

  /** False when the user has no such loan, whoever else may. */
  async deleteLoan(id: string): Promise<boolean> {
    return (await this.ctx.db.run("DELETE FROM loans WHERE user_id = ? AND id = ?", [this.ctx.userId, id])).changes > 0;
  }

  /**
   * A merchant's name was derived again: the statements that give each loan linked to a series of it the series' new
   * key. A key follows as the "Ei laina" answer on the same series does (core `renamedMarkSubject`). The marks repo
   * runs them in the transaction that moves the marks, so a run that is cut short has moved both or neither. Each
   * loan is written by its id: two names that trade places in one run do not meet.
   */
  async seriesKeyMoves(renames: ReadonlyMap<string, string>): Promise<Statement[]> {
    const rows = await this.ctx.db.all<Row>("SELECT id, series_key FROM loans WHERE user_id = ? AND series_key IS NOT NULL", [this.ctx.userId]);
    return rows.flatMap((r) => {
      const to = notLoanKey(renamedMarkSubject(notLoanMark({ key: String(r.series_key) }).subject, renames) ?? "");
      return to === null ? [] : [{ sql: "UPDATE loans SET series_key = ? WHERE user_id = ? AND id = ?", params: [to, this.ctx.userId, String(r.id)] }];
    });
  }
}
