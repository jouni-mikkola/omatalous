import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

async function plan(sql: string, params: string[]): Promise<string> {
  const { s } = await setupApp();
  return (await s.db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)).map((r) => r.detail).join("\n");
}

describe("indexes for the sync and lookup queries", () => {
  it("pending rows are found through their own index", async () => {
    const sql = "SELECT id FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'pending' AND category_source = 'user'";
    expect(await plan(sql, ["u", "a"])).toContain("idx_tx_account_pending");
    expect(await plan("DELETE FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'pending'", ["u", "a"])).toContain("idx_tx_account_pending");
  });

  it("uncategorised rows are found through their own index", async () => {
    const sql = "SELECT merchant FROM transactions WHERE user_id = ? AND category_source = 'default' AND amount_cents < 0 AND is_transfer = 0";
    expect(await plan(sql, ["u"])).toContain("idx_tx_user_uncategorised");
  });
});
