/** What money from a payer is, as the user answered it (and the household's rows core still reads): `payer_role`. Never touches a transaction. */
import type { PayerRole, PayerRoleRow } from "@banking/core";
import type { Row } from "../rows.ts";
import type { FinanceContext } from "./context.ts";

export class PayerRolesRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /** The roles this user's run reads: their own answers and any household rows; another member's own answer never. */
  async payerRoles(): Promise<PayerRoleRow[]> {
    const rows = await this.ctx.db.all<Row>("SELECT scope, user_id, counterparty_key, role FROM payer_role WHERE scope = 'household' OR user_id = ? ORDER BY scope, counterparty_key", [this.ctx.userId]);
    return rows.map((r) => ({ scope: String(r.scope) as PayerRoleRow["scope"], userId: r.user_id === null ? null : String(r.user_id), counterpartyKey: String(r.counterparty_key), role: String(r.role) as PayerRole }));
  }

  /** One answer per member and payer: a later one replaces the earlier. Only the member's own answer is written; household rows are read, never set. */
  async setPayerRole(key: string, role: PayerRole, at: string): Promise<void> {
    await this.ctx.db.run(
      `INSERT INTO payer_role (scope, user_id, counterparty_key, role, answered_by, answered_at) VALUES ('member', ?, ?, ?, ?, ?)
       ON CONFLICT (scope, COALESCE(user_id, ''), counterparty_key) DO UPDATE SET role = excluded.role, answered_by = excluded.answered_by, answered_at = excluded.answered_at`,
      [this.ctx.userId, key, role, this.ctx.userId, at],
    );
  }

  /** Takes the member's own answer row away ("palauta ehdotus"); the rows of the payer's transactions are the reprocess's to move back. */
  async clearPayerRole(key: string): Promise<void> {
    await this.ctx.db.run("DELETE FROM payer_role WHERE scope = 'member' AND user_id = ? AND counterparty_key = ?", [this.ctx.userId, key]);
  }
}
