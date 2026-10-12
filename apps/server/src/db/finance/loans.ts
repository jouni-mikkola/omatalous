/** Loans the user typed in and confirmed. Own rows only, though a view holds another member's loan paid from an account it counts, built from those rows by `loansInView`: sharing an account shares no row. */
import { LOAN_KINDS, LOAN_REFERENCES, LOAN_REPAYMENTS, type Loan, notLoanKey, notLoanMark, renamedMarkSubject } from "@banking/core";
import { num, type Row, str } from "../rows.ts";
import type { SqlValue, Statement } from "../types.ts";
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
  "account_id",
  "rate_review_date",
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
  l.accountId ?? null,
  l.rateReviewDate ?? null,
];

/**
 * True when no other loan of the user's names the account a loan is saved with: an account has one saved loan. It is
 * part of the statement that writes the loan, so of two requests that name one account at the same moment one writes
 * and the other does not. The database has no unique index to say so (migration 0016). A loan that names no account
 * always passes. The values are `holderParams`.
 */
const ACCOUNT_FREE = "NOT EXISTS (SELECT 1 FROM loans AS held WHERE held.user_id = ? AND held.account_id = ? AND held.id <> ?)";
const holderParams = (userId: string, l: Loan): SqlValue[] => [userId, l.accountId ?? null, l.id];

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
  // a loan without a link has no field, so it reads as it did before the column
  ...(r.account_id == null ? {} : { accountId: String(r.account_id) }),
  // likewise for a loan with no review day typed
  ...(r.rate_review_date == null ? {} : { rateReviewDate: String(r.rate_review_date) }),
});

export class LoansRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /** The user's loans in the order they were added. */
  async listLoans(): Promise<Loan[]> {
    return (await this.ctx.db.all<Row>("SELECT * FROM loans WHERE user_id = ? ORDER BY created_at, rowid", [this.ctx.userId])).map(toLoan);
  }

  /**
   * The user's other loan that names the loan's account: the one in the way of a save. Only a write past this repo
   * makes two of them, and then it is the one saved first, the order of `listLoans`: the one the debt totals give the
   * account to (core `householdDebts`).
   */
  private async holder(loan: Loan): Promise<Loan | null> {
    const r = await this.ctx.db.first<Row>("SELECT * FROM loans WHERE user_id = ? AND account_id = ? AND id <> ? ORDER BY created_at, rowid LIMIT 1", holderParams(this.ctx.userId, loan));
    return r ? toLoan(r) : null;
  }

  /**
   * Saves a new loan: null when it is saved. When another loan of the user's names its account already, nothing is
   * written and that loan is the answer (`ACCOUNT_FREE`).
   */
  async addLoan(loan: Loan, at: string): Promise<Loan | null> {
    const saved = await this.ctx.db.run(
      `INSERT INTO loans (id, user_id, ${COLUMNS.join(", ")}, created_at, updated_at) SELECT ?, ?, ${COLUMNS.map(() => "?").join(", ")}, ?, ? WHERE ${ACCOUNT_FREE}`,
      [loan.id, this.ctx.userId, ...values(loan), at, at, ...holderParams(this.ctx.userId, loan)],
    );
    if (saved.changes > 0) return null;
    // a loan in the way that let go of the account since leaves it free: the save runs again
    return (await this.holder(loan)) ?? this.addLoan(loan, at);
  }

  /**
   * Replaces every field of the user's loan: true when it is saved, false when the user has no such loan, whoever else
   * may. When another loan of the user's names its account already, nothing is written and that loan is the answer
   * (`ACCOUNT_FREE`). A loan saved again with the account it has passes: it is not in its own way.
   */
  async updateLoan(loan: Loan, at: string): Promise<boolean | Loan> {
    const set = COLUMNS.map((c) => `${c} = ?`).join(", ");
    const saved = await this.ctx.db.run(`UPDATE loans SET ${set}, updated_at = ? WHERE user_id = ? AND id = ? AND ${ACCOUNT_FREE}`, [
      ...values(loan),
      at,
      this.ctx.userId,
      loan.id,
      ...holderParams(this.ctx.userId, loan),
    ]);
    if (saved.changes > 0) return true;
    if (!(await this.ctx.db.first<Row>("SELECT id FROM loans WHERE user_id = ? AND id = ?", [this.ctx.userId, loan.id]))) return false;
    // as in `addLoan`: the loan is there and nothing holds its account any more, so the save runs again
    return (await this.holder(loan)) ?? this.updateLoan(loan, at);
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
