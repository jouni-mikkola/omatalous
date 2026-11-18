/**
 * The split of a loan's payment a loan document stated (`PaymentParts`), one row per payment. Own rows only: a part
 * is written under a loan of this user's, and the composite key (user_id, loan_id) of the table refuses any other.
 * A view that holds another member's loan reads its parts through that loan (`loansInView`), never from here.
 */
import type { PaymentParts } from "@banking/core";
import { num, type Row } from "../rows.ts";
import type { FinanceContext } from "./context.ts";

/** A loan keeps the newest of these: two years of monthly payments are more than any figure reads. */
const MAX_PAYMENT_PARTS = 24;

export class LoanPartsRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /** The parts of the user's loans by loan id, each loan's oldest payment first. */
  async partsByLoan(): Promise<Map<string, PaymentParts[]>> {
    const rows = await this.ctx.db.all<Row>("SELECT loan_id, due_date, principal_cents, interest_cents, fee_cents FROM loan_payment_parts WHERE user_id = ? ORDER BY loan_id, due_date", [this.ctx.userId]);
    const out = new Map<string, PaymentParts[]>();
    for (const r of rows) {
      const list = out.get(String(r.loan_id)) ?? [];
      list.push({ dueDate: String(r.due_date), principalCents: num(r.principal_cents) ?? 0, interestCents: num(r.interest_cents) ?? 0, feeCents: num(r.fee_cents) ?? 0 });
      out.set(String(r.loan_id), list);
    }
    return out;
  }

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
    await this.ctx.db.run(
      `DELETE FROM loan_payment_parts WHERE user_id = ? AND loan_id = ? AND due_date NOT IN (
         SELECT due_date FROM loan_payment_parts WHERE user_id = ? AND loan_id = ? ORDER BY due_date DESC LIMIT ?)`,
      [this.ctx.userId, loanId, this.ctx.userId, loanId, MAX_PAYMENT_PARTS],
    );
    return true;
  }
}
