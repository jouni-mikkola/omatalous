/** Bills the user typed in because the bank history cannot know them yet. Own rows only. */
import type { ExpectedBill, ExpectedCadence } from "@banking/core";
import type { Row } from "../rows.ts";
import type { FinanceContext } from "./context.ts";

export class ExpectedBillsRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /** The user's expected bills, the first due date first. */
  async listExpectedBills(): Promise<ExpectedBill[]> {
    const rows = await this.ctx.db.all<Row>("SELECT * FROM expected_bills WHERE user_id = ? ORDER BY due_date, id", [this.ctx.userId]);
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      amountCents: Number(r.amount_cents),
      dueDate: String(r.due_date),
      cadence: String(r.cadence) as ExpectedCadence,
      category: r.category === null ? null : String(r.category),
      ...(r.reference ? { reference: String(r.reference) } : {}),
      ...(r.payee_iban ? { payeeIban: String(r.payee_iban) } : {}),
    }));
  }

  async addExpectedBill(bill: ExpectedBill, createdAt: string): Promise<void> {
    await this.ctx.db.run(
      "INSERT INTO expected_bills (id, user_id, name, amount_cents, due_date, cadence, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [bill.id, this.ctx.userId, bill.name, bill.amountCents, bill.dueDate, bill.cadence, bill.category, createdAt],
    );
  }

  /** False when the user has no such bill, whoever else may. */
  async deleteExpectedBill(id: string): Promise<boolean> {
    return (await this.ctx.db.run("DELETE FROM expected_bills WHERE user_id = ? AND id = ?", [this.ctx.userId, id])).changes > 0;
  }
}
