import { describe, expect, it } from "vitest";
import { normalizeMerchant, type RawTransaction } from "@banking/core";
import type { StoredTransaction } from "../src/db/rows.ts";
import { reprocess, withUserLock } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { setupApp } from "./helpers.ts";

type Setup = Awaited<ReturnType<typeof setupApp>>;

async function history(setup: Setup, count: number, accountId = "acc") {
  const repo = setup.s.finance(setup.adminId);
  await repo.upsertAccount({ id: accountId, connectionId: null, provider: "csv", externalId: null, identity: accountId, name: accountId, iban: null, currency: "EUR", type: "checking" });
  const rows: Omit<StoredTransaction, "userId">[] = Array.from({ length: count }, (_, i) => ({
    id: `r${String(i).padStart(6, "0")}`,
    accountId,
    // a few dates only, so the id breaks most ties and page borders fall inside a day
    bookingDate: `2026-0${1 + (i % 9)}-0${1 + (i % 3)}`,
    valueDate: null,
    amountCents: -(100 + (i % 977)),
    currency: "EUR",
    status: "booked" as const,
    counterparty: null,
    counterpartyIban: null,
    description: i % 2 ? "K-MARKET KAMPPI" : `KAUPPA ${i % 300}`,
    reference: null,
    mcc: null,
    merchant: i % 2 ? "K-Market Kamppi" : `Kauppa ${i % 300}`,
    category: "other",
    categorySource: "default" as const,
    isTransfer: false,
    source: "test",
    raw: null,
  }));
  await repo.batch(repo.upsertStatements(rows, "2026-10-09T10:00:00Z"));
  return repo;
}

/** Counts how often the event loop gets a turn while `work` runs. */
async function turnsDuring(work: () => Promise<unknown>): Promise<number> {
  let turns = 0;
  let done = false;
  const watcher = (async () => {
    while (!done) {
      await new Promise((r) => setImmediate(r));
      turns++;
    }
  })();
  await work();
  done = true;
  await watcher;
  return turns;
}

describe("long work gives the event loop back", () => {
  it("reads a history in pages that equal one query, ties on the date included", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 12_345);
    const paged = await repo.allTransactions();
    const direct = await setup.db.all<{ id: string }>("SELECT id FROM transactions WHERE user_id = ? ORDER BY booking_date, id", [setup.adminId]);
    expect(paged.map((t) => t.id)).toEqual(direct.map((r) => r.id));
    expect(paged).toHaveLength(12_345);
    expect(new Set(paged.map((t) => t.id)).size).toBe(12_345);
  });

  it("reprocess of a long history lets other work run", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 12_000);
    const turns = await turnsDuring(() => reprocess(repo, setup.s.settings));
    // pages of the read, stages of the enrichment, chunks of the write
    expect(turns).toBeGreaterThan(8);
    expect((await repo.allTransactions()).some((t) => t.category !== "other")).toBe(true);
  });

  it("a long CSV export and a long list do not hold the loop for their whole run", async () => {
    const setup = await setupApp();
    await history(setup, 9000);
    const turns = await turnsDuring(() => setup.admin.call("GET", "/api/export/transactions.csv?from=2026-01-01&to=2026-12-31"));
    expect(turns).toBeGreaterThan(2);
  });

  it("two runs for one user do not overlap, runs for different users may", async () => {
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name} start`);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      log.push(`${name} end`);
    };
    await Promise.all([withUserLock("u1", task("a")), withUserLock("u1", task("b")), withUserLock("u2", task("c"))]);
    expect(log.indexOf("a end")).toBeLessThan(log.indexOf("b start"));
    expect(log.indexOf("c start")).toBeLessThan(log.indexOf("a end"));
    // a failed run does not block the next one
    await expect(withUserLock("u1", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(withUserLock("u1", async () => "later")).resolves.toBe("later");
  });

  it("a rule added while a reprocess runs ends in the state of a fresh run", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 6000);
    const first = reprocess(repo, setup.s.settings);
    await repo.addRule({ field: "merchant_exact", pattern: "Kauppa 7", category: "restaurants", priority: 10 });
    const second = reprocess(repo, setup.s.settings);
    await Promise.all([first, second]);
    const rows = await repo.allTransactions();
    expect(rows.filter((t) => t.merchant === "Kauppa 7").every((t) => t.category === "restaurants" && t.categorySource === "rule")).toBe(true);
    // nothing left to change
    expect(await reprocess(repo, setup.s.settings)).toBe(0);
  });
});

describe("the upgrade tasks read each history once", () => {
  it("one history read per user, with the same result as before", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 3000);
    // rows from before search_text existed and a merchant name an older version derived differently
    await setup.db.run("UPDATE transactions SET search_text = ''");
    await setup.db.run("UPDATE transactions SET merchant = 'Vanha nimi' WHERE id < 'r000100' AND merchant != 'K-Market Kamppi'");
    const reads: string[] = [];
    const all = setup.db.all.bind(setup.db);
    setup.db.all = (async (sql: string, params?: never) => {
      if ((/FROM transactions WHERE user_id = \?[^"]*ORDER BY booking_date, id/.test(sql) && !/BETWEEN/.test(sql)) || /search_text FROM transactions/.test(sql)) reads.push(sql.slice(0, 60));
      return all(sql, params);
    }) as typeof setup.db.all;

    const result = await runUpgradeTasks(setup.s, "9.9.9+once");
    expect(result?.users).toBe(1);
    expect(result!.merchantsRenamed).toBeGreaterThanOrEqual(50);
    // one read for the user (one page), plus the empty history of the other users: none
    expect(reads).toHaveLength(1);
    const rows = await repo.allTransactions();
    expect(rows.filter((t) => t.merchant === "Vanha nimi")).toHaveLength(0);
    expect(rows.find((t) => t.id === "r000000")?.merchant).toBe(normalizeMerchant(null, "KAUPPA 0"));
    expect(rows.find((t) => t.id === "r000001")?.category).toBe("groceries");
    const texts = await setup.db.all<{ search_text: string | null }>("SELECT search_text FROM transactions");
    expect(texts.every((r) => r.search_text !== null && r.search_text.length > 0)).toBe(true);
  });
});

describe("a big import is written in pieces", () => {
  const raws = (n: number): RawTransaction[] =>
    Array.from({ length: n }, (_, i) => ({
      externalId: `x${i}`, bookingDate: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, valueDate: null, amountCents: -(100 + i), currency: "EUR", status: "booked" as const,
      counterparty: `KAUPPA ${i % 50}`, counterpartyIban: null, description: null, reference: null, mcc: null,
    }));

  it("stores every row, leaves the mark in the first and the last piece, and the loop gets turns", async () => {
    const setup = await setupApp();
    const repo = setup.s.finance(setup.adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Tili", iban: null, currency: "EUR", type: "checking" });
    let result: Awaited<ReturnType<typeof ingestTransactions>> | undefined;
    const turns = await turnsDuring(async () => {
      result = await ingestTransactions(repo, "chk", raws(5200), "csv", { replacePending: false });
    });
    expect(result).toMatchObject({ inserted: 5200, changed: 5200 });
    expect(turns).toBeGreaterThan(2);
    expect(await repo.allTransactions()).toHaveLength(5200);
    expect(await repo.unprocessedMark()).not.toBeNull();
  });

  it("a stop between pieces leaves the mark set and a repeat fills in the rest", async () => {
    const setup = await setupApp();
    const repo = setup.s.finance(setup.adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Tili", iban: null, currency: "EUR", type: "checking" });
    const batch = repo.batch.bind(repo);
    let calls = 0;
    repo.batch = async (statements) => {
      if (++calls === 2) throw new Error("killed");
      return batch(statements);
    };
    await expect(ingestTransactions(repo, "chk", raws(5200), "csv", { replacePending: false })).rejects.toThrow("killed");
    repo.batch = batch;
    expect((await repo.allTransactions()).length).toBe(2000);
    expect(await repo.unprocessedMark()).not.toBeNull();
    // the same fetch again: what is stored stays, the rest comes
    const again = await ingestTransactions(repo, "chk", raws(5200), "csv", { replacePending: false });
    expect(again).toMatchObject({ inserted: 3200, updated: 2000, changed: 3200 });
    expect(await repo.allTransactions()).toHaveLength(5200);
  });
});
