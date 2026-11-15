import { describe, expect, it } from "vitest";
import type { StoredTransaction } from "../src/db/rows.ts";
import { reprocess } from "../src/services/enrich.ts";
import { ACCOUNTS, randomHistory, rng } from "../../../packages/core/test/gen.ts";
import { setupApp } from "./helpers.ts";

/** More seeds for a long local run: INCREMENTAL_SEEDS=60 */
const SEEDS = Array.from({ length: Number(process.env.INCREMENTAL_SEEDS ?? 4) }, (_, i) => i + 1);
type App = Awaited<ReturnType<typeof setupApp>>;

/** Loads the same history into a fresh app and categorises it fully, as a finished import leaves it. */
async function load(seed: number, count: number, currentBuild: boolean): Promise<App> {
  const app = await setupApp();
  const repo = app.s.finance(app.adminId);
  for (const a of ACCOUNTS) await repo.upsertAccount({ id: a.id, connectionId: null, provider: "csv", externalId: null, identity: a.id, name: a.name, iban: a.iban, currency: "EUR", type: a.type });
  const { txs } = randomHistory(seed, count);
  const rows: Omit<StoredTransaction, "userId">[] = txs.map((t) => ({
    ...t,
    valueDate: null,
    reference: null,
    source: "test",
    raw: null,
    // placeholders, as an import writes them, except the user's own choices
    category: t.categorySource === "user" ? t.category : t.amountCents >= 0 ? "income" : "other",
    categorySource: t.categorySource === "user" ? ("user" as const) : ("default" as const),
    isTransfer: false,
  }));
  await repo.batch(repo.upsertStatements(rows, "2026-10-09T10:00:00Z"));
  await reprocess(repo, app.s.settings);
  // "the upgrade tasks have run for this build": the shortcut for a single change is allowed
  if (currentBuild) await app.s.settings.set("app_build", app.s.build.id);
  return app;
}

const state = (app: App) =>
  app.db.all<{ id: string; category: string; category_source: string; is_transfer: number }>("SELECT id, category, category_source, is_transfer FROM transactions ORDER BY id");
const rulesOf = (app: App) => app.db.all("SELECT field, pattern, category, priority FROM category_rules ORDER BY id");

describe("one change at a time gives the same stored rows as a full reprocess", () => {
  it("category edits, merchant rules and their removal over random histories", async () => {
    let incremental = 0;
    let operations = 0;
    for (const seed of SEEDS) {
      const fast = await load(seed, 500, true);
      const full = await load(seed, 500, false);
      expect(await state(fast)).toEqual(await state(full));
      const r = rng(seed * 77);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
      // the shortcut is counted by the history pages a call reads: it reads none
      let reads = 0;
      const all = fast.db.all.bind(fast.db);
      fast.db.all = (async (sql: string, params?: never) => {
        if (/ORDER BY booking_date, id LIMIT/.test(sql)) reads++;
        return all(sql, params);
      }) as typeof fast.db.all;

      for (let op = 0; op < 24; op++) {
        const rows = (await fast.db.all<{ id: string; merchant: string; category_source: string }>("SELECT id, merchant, category_source FROM transactions WHERE category_source != 'transfer' ORDER BY id")).filter((t) => t.merchant !== "Siirto");
        const target = pick(rows);
        const category = pick(["groceries", "restaurants", "shopping", "hobbies", "health", "other", "savings", "p2p"]);
        const kind = pick(["edit", "edit", "edit", "rule-edit", "null", "rule", "unrule"] as const);
        const call = async (app: App) => {
          if (kind === "edit") return app.admin.call("PATCH", `/api/transactions/${target.id}`, { category });
          if (kind === "rule-edit") return app.admin.call("PATCH", `/api/transactions/${target.id}`, { category, createRule: true });
          if (kind === "null") return app.admin.call("PATCH", `/api/transactions/${target.id}`, { category: null });
          if (kind === "rule") return app.admin.call("PUT", "/api/merchants/category", { merchant: target.merchant, category });
          return app.admin.call("DELETE", "/api/merchants/rule", { merchant: target.merchant });
        };
        const before = reads;
        const a = await call(fast);
        const b = await call(full);
        expect(a.status, `${kind} ${target.merchant}`).toBe(b.status);
        // the answer the web app shows is the same too
        expect(a.body.changed, `${kind} ${target.merchant}`).toBe(b.body.changed);
        const x = await state(fast);
        const y = await state(full);
        const wrong = x.find((row, i) => JSON.stringify(row) !== JSON.stringify(y[i]));
        expect(wrong, `seed ${seed} op ${op} ${kind} ${target.merchant}`).toBeUndefined();
        expect(await rulesOf(fast)).toEqual(await rulesOf(full));
        operations++;
        if (reads === before) incremental++;
      }
    }
    if (process.env.INCREMENTAL_DEBUG) console.log(`incremental ${incremental} of ${operations}`);
    expect(operations).toBe(SEEDS.length * 24);
    // the shortcut is really taken for a good part of ordinary changes
    expect(incremental).toBeGreaterThan(operations * 0.3);
  }, 900_000);

  it("is not taken before the upgrade tasks have finished for this build", async () => {
    const app = await load(5, 200, false);
    let reads = 0;
    const all = app.db.all.bind(app.db);
    app.db.all = (async (sql: string, params?: never) => {
      if (/ORDER BY booking_date, id LIMIT/.test(sql)) reads++;
      return all(sql, params);
    }) as typeof app.db.all;
    const id = (await app.db.first<{ id: string }>("SELECT id FROM transactions WHERE merchant = 'K-Market Kamppi' AND category_source != 'user' LIMIT 1"))!.id;
    expect((await app.admin.call("PATCH", `/api/transactions/${id}`, { category: "restaurants" })).status).toBe(200);
    expect(reads).toBeGreaterThan(0);
  }, 30_000);

  it("is not taken while an import waits for its categories", async () => {
    const app = await load(6, 200, true);
    const repo = app.s.finance(app.adminId);
    await repo.batch(repo.unprocessedStatements("2026-10-09T10:00:00Z"));
    let reads = 0;
    const all = app.db.all.bind(app.db);
    app.db.all = (async (sql: string, params?: never) => {
      if (/ORDER BY booking_date, id LIMIT/.test(sql)) reads++;
      return all(sql, params);
    }) as typeof app.db.all;
    const id = (await app.db.first<{ id: string }>("SELECT id FROM transactions WHERE merchant = 'K-Market Kamppi' AND category_source != 'user' LIMIT 1"))!.id;
    await app.admin.call("PATCH", `/api/transactions/${id}`, { category: "restaurants" });
    expect(reads).toBeGreaterThan(0);
    // the full run cleared the mark
    expect(await repo.unprocessedMark()).toBeNull();
  }, 30_000);

  it("an older whole-word rule for the name makes the change a full reprocess, so rows of other merchants follow", async () => {
    const app = await load(7, 300, true);
    const repo = app.s.finance(app.adminId);
    await repo.addRule({ field: "merchant", pattern: "Kahvila", category: "hobbies", priority: 10 });
    await reprocess(repo, app.s.settings);
    let reads = 0;
    const all = app.db.all.bind(app.db);
    app.db.all = (async (sql: string, params?: never) => {
      if (/ORDER BY booking_date, id LIMIT/.test(sql)) reads++;
      return all(sql, params);
    }) as typeof app.db.all;
    expect((await app.admin.call("DELETE", "/api/merchants/rule", { merchant: "Kahvila" })).status).toBe(200);
    expect(reads).toBeGreaterThan(0);
    expect(await app.db.first("SELECT 1 FROM transactions WHERE category = 'hobbies' AND merchant LIKE '%Kahvila%' AND category_source = 'rule'")).toBeNull();
  }, 30_000);
});
