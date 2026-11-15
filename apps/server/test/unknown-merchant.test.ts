import { UNKNOWN_MERCHANT } from "@banking/core";
import { describe, expect, it } from "vitest";
import type { StoredTransaction } from "../src/db/rows.ts";
import { reprocess } from "../src/services/enrich.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { setupApp } from "./helpers.ts";

/** A card reservation has no merchant name, so its merchant is the placeholder every unnamed row shares. */
async function withUnnamedRows() {
  const app = await setupApp();
  const repo = app.s.finance(app.adminId);
  await repo.upsertAccount({ id: "card", connectionId: null, provider: "csv", externalId: null, identity: "card", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" });
  const row = (id: string, bookingDate: string, merchant: string, counterparty: string | null): Omit<StoredTransaction, "userId"> => ({
    id,
    accountId: "card",
    bookingDate,
    valueDate: null,
    amountCents: -1500,
    currency: "EUR",
    status: "booked",
    counterparty,
    counterpartyIban: null,
    description: null,
    reference: null,
    mcc: null,
    merchant,
    category: "other",
    categorySource: "default",
    isTransfer: false,
    source: "test",
    raw: null,
  });
  await repo.batch(
    repo.upsertStatements(
      [row("t-a", "2026-09-20", UNKNOWN_MERCHANT, null), row("t-b", "2026-09-12", UNKNOWN_MERCHANT, null), row("t-c", "2026-09-10", "Qwerty Puoti", "QWERTY PUOTI")],
      "2026-10-09T10:00:00Z",
    ),
  );
  await reprocess(repo, app.s.settings);
  const categories = async () => Object.fromEntries((await repo.allTransactions()).map((t) => [t.id, `${t.category}/${t.categorySource}`]));
  return { ...app, repo, categories };
}

describe("a category for an unnamed row", () => {
  it("changes that row only, with the merchant checkbox on", async () => {
    const { admin, categories } = await withUnnamedRows();
    expect(await categories()).toEqual({ "t-a": "other/default", "t-b": "other/default", "t-c": "other/default" });

    const r = await admin.call("PATCH", "/api/transactions/t-a", { category: "restaurants", createRule: true });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(1);
    expect(r.body.transaction).toMatchObject({ id: "t-a", category: "restaurants", categorySource: "user" });
    // the other unnamed row and the named one stay as they were
    expect(await categories()).toEqual({ "t-a": "restaurants/user", "t-b": "other/default", "t-c": "other/default" });
    expect((await admin.call("GET", "/api/rules")).body.rules).toEqual([]);
    const unnamed = (await admin.call("GET", "/api/merchants")).body.items.find((m: { merchant: string }) => m.merchant === UNKNOWN_MERCHANT);
    expect(unnamed.rule).toBeNull();
  });

  it("still becomes the merchant's rule for a named merchant", async () => {
    const { admin, categories } = await withUnnamedRows();
    const r = await admin.call("PATCH", "/api/transactions/t-c", { category: "shopping", createRule: true });
    expect(r.body.changed).toBe(1);
    expect((await admin.call("GET", "/api/rules")).body.rules).toMatchObject([{ field: "merchant_exact", pattern: "Qwerty Puoti", category: "shopping" }]);
    expect(await categories()).toEqual({ "t-a": "other/default", "t-b": "other/default", "t-c": "shopping/user" });
  });

  it("is refused as a rule for all unnamed rows on Kauppiaat", async () => {
    const { admin, categories } = await withUnnamedRows();
    const r = await admin.call("PUT", "/api/merchants/category", { merchant: UNKNOWN_MERCHANT, category: "restaurants" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Tuntemattomalle kauppiaalle ei voi asettaa kategoriaa. Vaihda kategoria tapahtumalta.");
    expect((await admin.call("GET", "/api/rules")).body.rules).toEqual([]);
    expect(await categories()).toEqual({ "t-a": "other/default", "t-b": "other/default", "t-c": "other/default" });
  });
});

describe("a rule typed on Säännöt", () => {
  it("is refused for the unnamed merchant and accepted for other fields", async () => {
    const { admin } = await withUnnamedRows();
    for (const field of ["merchant", "merchant_exact"]) {
      const r = await admin.call("POST", "/api/rules", { field, pattern: "tuntematon", category: "restaurants" });
      expect(r.status, field).toBe(400);
      expect(r.body.error).toMatch(/^Tuntemattomalle kauppiaalle/);
    }
    expect((await admin.call("POST", "/api/rules", { field: "description", pattern: "tuntematon", category: "restaurants" })).status).toBe(200);
  });
});

describe("a rule for unnamed rows from an older version", () => {
  it("has no effect and is removed by the upgrade, which keeps the rows set by hand", async () => {
    const { admin, s, repo, categories } = await withUnnamedRows();
    // as 0.8.3 left them: a merchant rule and an older whole-word rule, one row by hand and one a rule moved
    await repo.setMerchantRule(UNKNOWN_MERCHANT, "restaurants");
    await repo.addRule({ field: "merchant", pattern: UNKNOWN_MERCHANT, category: "restaurants", priority: 10 });
    await repo.setMerchantRule("Qwerty Puoti", "shopping");
    await repo.setUserCategory("t-a", "gifts");
    await s.db.run("UPDATE transactions SET category = 'restaurants', category_source = 'rule' WHERE id = 't-b'");

    // before the cleanup the rules already move nothing
    await reprocess(repo, s.settings);
    expect(await categories()).toEqual({ "t-a": "gifts/user", "t-b": "other/default", "t-c": "shopping/rule" });

    await s.db.run("UPDATE transactions SET category = 'restaurants', category_source = 'rule' WHERE id = 't-b'");
    expect(await runUpgradeTasks(s, "0.8.4+unknown-merchant")).toMatchObject({ users: 1 });
    expect((await repo.listRules()).map((r) => `${r.field}:${r.pattern}`)).toEqual(["merchant_exact:Qwerty Puoti"]);
    expect(await categories()).toEqual({ "t-a": "gifts/user", "t-b": "other/default", "t-c": "shopping/rule" });
    expect((await admin.call("GET", "/api/rules")).body.rules).toHaveLength(1);
  });
});
