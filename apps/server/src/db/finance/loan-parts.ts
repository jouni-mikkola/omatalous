/**
 * The split of a loan's payment a loan document stated (`PaymentParts`), one row per payment. Own rows only: a part
 * is written only under a loan of this user's (the insert reads the loan by user id and id), and read only through the
 * user's own loan row. A view that holds another member's loan reads its parts through that loan (`loansInView`),
 * never from here.
 */
import type { PaymentParts } from "@banking/core";
import type { Row } from "../rows.ts";
import type { Statement } from "../types.ts";
import type { FinanceContext } from "./context.ts";

/** A loan keeps the newest of these: two years of monthly payments are more than any figure reads. */
const MAX_PAYMENT_PARTS = 24;

/** The statement that keeps the newest `MAX_PAYMENT_PARTS` of a user's loan and deletes the older ones: a save and an import both end with it. */
export function trimPartsStatement(userId: string, loanId: string): Statement {
  return {
    sql: `DELETE FROM loan_payment_parts WHERE user_id = ? AND loan_id = ? AND due_date NOT IN (
         SELECT due_date FROM loan_payment_parts WHERE user_id = ? AND loan_id = ? ORDER BY due_date DESC LIMIT ?)`,
    params: [userId, loanId, userId, loanId, MAX_PAYMENT_PARTS],
  };
}

/**
 * The column a loan's select adds to read its parts in the same statement: the parts of that loan as a JSON list,
 * oldest payment first. The subquery names the loan row's own user id, so a part under another user's id is never read.
 */
export const PARTS_COLUMN = `(SELECT json_group_array(json_object('d', due_date, 'p', principal_cents, 'i', interest_cents, 'f', fee_cents))
  FROM (SELECT due_date, principal_cents, interest_cents, fee_cents FROM loan_payment_parts WHERE user_id = loans.user_id AND loan_id = loans.id ORDER BY due_date)) AS parts`;

/** The parts of a loan row that was read with `PARTS_COLUMN`: none when the loan has none. */
export function statedParts(r: Row): PaymentParts[] | undefined {
  const list = JSON.parse(String(r.parts ?? "[]")) as { d: string; p: number; i: number; f: number }[];
  return list.length ? list.map((x) => ({ dueDate: x.d, principalCents: x.p, interestCents: x.i, feeCents: x.f })) : undefined;
}

export class LoanPartsRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /**
   * Saves what a document stated of one payment of the user's loan, replacing the parts of the same due date, and
   * keeps the newest `MAX_PAYMENT_PARTS`. False when the user has no such loan, whoever else may: nothing is written.
   */
  async savePart(loanId: string, part: PaymentParts): Promise<boolean> {
    const saved = await this.ctx.db.run(
      `INSERT INTO loan_payment_parts (user_id, loan_id, due_date, principal_cents, interest_cents, fee_cents)
       SELECT user_id, id, ?, ?, ?, ? FROM loans WHERE user_id = ? AND id = ?
       ON CONFLICT (loan_id, due_date) DO UPDATE SET principal_cents = excluded.principal_cents, interest_cents = excluded.interest_cents, fee_cents = excluded.fee_cents`,
      [part.dueDate, part.principalCents, part.interestCents, part.feeCents, this.ctx.userId, loanId],
    );
    if (saved.changes === 0) return false;
    const trim = trimPartsStatement(this.ctx.userId, loanId);
    await this.ctx.db.run(trim.sql, trim.params);
    return true;
  }
}
