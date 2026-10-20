import { describe, expect, it } from "vitest";
import { optimizeDatabase } from "../src/db/pragmas.ts";
import { setupApp } from "./helpers.ts";

/** A history of mostly categorised, booked rows with a few pending and uncategorised ones, as a real one is. */
async function populated() {
  const app = await setupApp();
  const repo = app.s.finance(app.adminId);
  await repo.upsertAccount({ id: "acc", connectionId: null, provider: "csv", externalId: null, identity: "acc", name: "Tili", iban: null, currency: "EUR", type: "checking" });
  await repo.batch(
    repo.upsertStatements(
      Array.from({ length: 3000 }, (_, i) => ({
        id: `row${i}`,
        accountId: "acc",
        bookingDate: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}`,
        valueDate: null,
        amountCents: -(100 + i),
        currency: "EUR",
        status: i % 600 === 0 ? ("pending" as const) : ("booked" as const),
        counterparty: null,
        counterpartyIban: null,
        description: null,
        reference: null,
        mcc: null,
        merchant: `Kauppa ${i % 40}`,
        category: "groceries",
        categorySource: i % 300 === 0 ? ("default" as const) : ("rule" as const),
        isTransfer: false,
        source: "test",
        raw: null,
      })),
      "2026-10-09T10:00:00Z",
    ),
  );
  return app;
}

async function plan(sql: string, params: string[]): Promise<string> {
  const { s } = await populated();
  await optimizeDatabase(s.db);
  return (await s.db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)).map((r) => r.detail).join("\n");
}

describe("indexes for the sync and lookup queries", () => {
  it("pending rows are found through their own index", async () => {
    const sql = "SELECT id FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'pending'";
    expect(await plan(sql, ["u", "acc"])).toContain("idx_tx_account_pending");
    expect(await plan("DELETE FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'pending'", ["u", "acc"])).toContain("idx_tx_account_pending");
  });

  it("uncategorised rows are found through their own index", async () => {
    const sql = "SELECT merchant FROM transactions WHERE user_id = ? AND category_source = 'default' AND amount_cents < 0 AND is_transfer = 0";
    expect(await plan(sql, ["u"])).toContain("idx_tx_user_uncategorised");
  });
});

describe("table statistics", () => {
  it("optimize analyses a database that has none, and is a no-op the second time", async () => {
    const { s } = await populated();
    expect(await s.db.first("SELECT 1 FROM sqlite_stat1 WHERE idx = 'idx_tx_user_date_amount'")).toBeNull();
    await optimizeDatabase(s.db);
    const stats = await s.db.all<{ idx: string }>("SELECT idx FROM sqlite_stat1 WHERE tbl = 'transactions'");
    expect(stats.map((r) => r.idx)).toEqual(expect.arrayContaining(["idx_tx_user_date_amount", "idx_tx_user_merchant_date", "idx_tx_user_category_date", "idx_tx_account_pending"]));
    await expect(optimizeDatabase(s.db)).resolves.toBeUndefined();
  });
});
