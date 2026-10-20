import { describe, expect, it } from "vitest";
import { normalizeMerchant, type RawTransaction } from "@banking/core";
import type { StoredTransaction } from "../src/db/rows.ts";
import { AnalysisCache } from "../src/services/analysis.ts";
import { lockedOutside, reprocess, withUserLock } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { setupApp } from "./helpers.ts";

type Setup = Awaited<ReturnType<typeof setupApp>>;

async function history(setup: Setup, count: number, accountId = "acc", userId = setup.adminId) {
  const repo = setup.s.finance(userId);
  await repo.upsertAccount({ id: accountId, connectionId: null, provider: "csv", externalId: null, identity: accountId, name: accountId, iban: null, currency: "EUR", type: "checking" });
  const rows: Omit<StoredTransaction, "userId">[] = Array.from({ length: count }, (_, i) => ({
    id: `${accountId === "acc" ? "" : `${accountId}-`}r${String(i).padStart(6, "0")}`,
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
    // pages of the read, stages of the enrichment, pieces of the write
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
      result = await ingestTransactions(repo, "chk", raws(5200), "csv");
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
    await expect(ingestTransactions(repo, "chk", raws(5200), "csv")).rejects.toThrow("killed");
    repo.batch = batch;
    expect((await repo.allTransactions()).length).toBe(2000);
    expect(await repo.unprocessedMark()).not.toBeNull();
    // the same fetch again: what is stored stays, the rest comes
    const again = await ingestTransactions(repo, "chk", raws(5200), "csv");
    expect(again).toMatchObject({ inserted: 3200, updated: 2000, changed: 3200 });
    expect(await repo.allTransactions()).toHaveLength(5200);
  });
});

/** The longest time the event loop went without a turn while `work` ran, and how long `work` took. */
async function longestHold(work: () => Promise<unknown>): Promise<{ hold: number; total: number }> {
  let hold = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    hold = Math.max(hold, now - last);
    last = now;
  }, 1);
  const start = performance.now();
  await work();
  const total = performance.now() - start;
  // a hold that ends with the work is seen by the next tick only
  await new Promise((r) => setTimeout(r, 2));
  clearInterval(timer);
  return { hold, total };
}

describe("one user's reprocess and the others' requests", () => {
  it("a reprocess and the build of its analysis leave the loop to other members in short turns", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 12_000);
    const other = await setup.member("toinen");
    // what the other member does meanwhile: a short request at a time
    const waits: number[] = [];
    let done = false;
    const asking = (async () => {
      while (!done) {
        const start = performance.now();
        expect((await other.call("GET", "/api/auth/state")).status).toBe(200);
        waits.push(performance.now() - start);
        await new Promise((r) => setTimeout(r, 2));
      }
    })();
    const run = await longestHold(() => reprocess(repo, setup.s.settings));
    const build = await longestHold(() => setup.s.analysis.get(setup.s, setup.adminId, "own"));
    done = true;
    await asking;
    // relative bounds hold on a busy machine too: no piece takes half of the whole
    expect(run.hold).toBeLessThan(run.total / 2);
    expect(build.hold).toBeLessThan(build.total / 2);
    expect(waits.length).toBeGreaterThan(4);
    expect(Math.max(...waits)).toBeLessThan((run.total + build.total) / 2);
  });

  it("two reprocesses of one user run one after the other, and the version moves once for each", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 3000);
    const log: string[] = [];
    const read = repo.allTransactions.bind(repo);
    const write = repo.updateEnrichment.bind(repo);
    let n = 0;
    repo.allTransactions = async () => {
      const i = ++n;
      log.push(`read ${i}`);
      const rows = await read();
      log.push(`read ${i} end`);
      return rows;
    };
    repo.updateEnrichment = async (txs) => {
      log.push("write");
      await write(txs);
      log.push("write end");
    };
    const before = await setup.s.settings.dataVersionOf([setup.adminId]);
    await Promise.all([reprocess(repo, setup.s.settings), reprocess(repo, setup.s.settings)]);
    expect(log).toEqual(["read 1", "read 1 end", "write", "write end", "read 2", "read 2 end", "write", "write end"]);
    const after = await setup.s.settings.dataVersionOf([setup.adminId]);
    expect(Number(after.split(".").at(-1)) - Number(before.split(".").at(-1))).toBe(2);
  });

  it("the analysis read between any two turns of a reprocess is all of the old or all of the new", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 6000);
    await reprocess(repo, setup.s.settings);
    await setup.s.analysis.get(setup.s, setup.adminId, "own");
    await repo.addRule({ field: "merchant_exact", pattern: "K-Market Kamppi", category: "restaurants", priority: 10 });
    const counts = new Set<number>();
    let done = false;
    const watching = (async () => {
      while (!done) {
        const { ctx } = await setup.s.analysis.get(setup.s, setup.adminId, "own");
        counts.add(ctx.txs.filter((t) => t.category === "restaurants").length);
        await new Promise((r) => setImmediate(r));
      }
    })();
    // a cache with nothing in it, asked once the rows are being written: it waits for the end
    const written = (async () => {
      while (lockedOutside([setup.adminId]) === false) await new Promise((r) => setImmediate(r));
      return new AnalysisCache().get(setup.s, setup.adminId, "own");
    })();
    await reprocess(repo, setup.s.settings);
    done = true;
    await watching;
    expect([...counts].every((n) => n === 0 || n === 3000)).toBe(true);
    expect(counts.has(0)).toBe(true);
    expect((await written).ctx.txs.filter((t) => t.category === "restaurants")).toHaveLength(3000);
  });

  it("a share that ended before a member's reprocess: during it the member waits for the analysis without that account", async () => {
    const setup = await setupApp();
    const bertta = await setup.member("bertta");
    await history(setup, 40, "a-x");
    await history(setup, 40, "a-y");
    const repo = await history(setup, 6000, "b-own", bertta.id);
    for (const id of ["a-x", "a-y"]) expect((await setup.admin.call("PUT", `/api/accounts/${id}/shares/${bertta.id}`)).status).toBe(200);
    const shown = (d: Awaited<ReturnType<typeof setup.s.analysis.get>>) => [...new Set(d.ctx.txs.map((t) => t.accountId))].sort();
    expect(shown(await setup.s.analysis.get(setup.s, bertta.id, "household"))).toEqual(["a-x", "a-y", "b-own"]);
    expect((await setup.admin.call("DELETE", `/api/accounts/a-x/shares/${bertta.id}`)).status).toBe(200);

    const running = reprocess(repo, setup.s.settings);
    while (!lockedOutside([bertta.id])) await new Promise((r) => setImmediate(r));
    const during = setup.s.analysis.get(setup.s, bertta.id, "household");
    await running;
    expect(shown(await during)).toEqual(["a-y", "b-own"]);
  });

  it("a member removed before a reprocess: during it the others wait for the analysis without the member's account", async () => {
    const setup = await setupApp();
    const [bertta, cecilia] = [await setup.member("bertta"), await setup.member("cecilia")];
    await history(setup, 40, "b-y", bertta.id);
    await history(setup, 40, "c-z", cecilia.id);
    const repo = await history(setup, 6000);
    expect((await bertta.call("PUT", `/api/accounts/b-y/shares/${setup.adminId}`)).status).toBe(200);
    expect((await cecilia.call("PUT", `/api/accounts/c-z/shares/${setup.adminId}`)).status).toBe(200);
    const shown = (d: Awaited<ReturnType<typeof setup.s.analysis.get>>) => [...new Set(d.ctx.txs.map((t) => t.accountId))].sort();
    expect(shown(await setup.s.analysis.get(setup.s, setup.adminId, "household"))).toEqual(["acc", "b-y", "c-z"]);
    expect((await setup.admin.call("DELETE", `/api/users/${bertta.id}`)).status).toBe(200);

    const running = reprocess(repo, setup.s.settings);
    while (!lockedOutside([setup.adminId])) await new Promise((r) => setImmediate(r));
    const during = setup.s.analysis.get(setup.s, setup.adminId, "household");
    await running;
    expect(shown(await during)).toEqual(["acc", "c-z"]);
  });

  it("an analysis from before an earlier run that ended is not served during the next one", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 3000);
    const old = await setup.s.analysis.get(setup.s, setup.adminId, "own");
    await repo.addRule({ field: "merchant_exact", pattern: "K-Market Kamppi", category: "restaurants", priority: 10 });
    // the first run ends with nobody asking; the second one runs when the next request comes
    await reprocess(repo, setup.s.settings);
    const second = reprocess(repo, setup.s.settings);
    while (!lockedOutside([setup.adminId])) await new Promise((r) => setImmediate(r));
    const during = await setup.s.analysis.get(setup.s, setup.adminId, "own");
    await second;
    expect(during).not.toBe(old);
    expect(during.ctx.txs.filter((t) => t.category === "restaurants")).toHaveLength(1500);
  });

  it("a request during a reprocess gets the analysis built before it, or waits for the one after it", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 6000);
    await reprocess(repo, setup.s.settings);
    const old = await setup.s.analysis.get(setup.s, setup.adminId, "own");
    const restaurants = (d: typeof old) => d.ctx.txs.filter((t) => t.category === "restaurants").length;
    expect(restaurants(old)).toBe(0);
    await repo.addRule({ field: "merchant_exact", pattern: "K-Market Kamppi", category: "restaurants", priority: 10 });

    const running = reprocess(repo, setup.s.settings);
    while (!lockedOutside([setup.adminId])) await new Promise((r) => setImmediate(r));
    // built before the run: the old answer, whole
    expect(await setup.s.analysis.get(setup.s, setup.adminId, "own")).toBe(old);
    // a cache that holds nothing yet waits for the run and reads its rows
    const fresh = new AnalysisCache().get(setup.s, setup.adminId, "own");
    await running;
    expect(restaurants(await fresh)).toBe(3000);
    // after the run the version has moved, so the own view is built again
    const now = await setup.s.analysis.get(setup.s, setup.adminId, "own");
    expect(now).not.toBe(old);
    expect(restaurants(now)).toBe(3000);
    expect(lockedOutside([setup.adminId])).toBe(false);
  });

  it("the work a reprocess runs under its lock reads the analysis without waiting for that lock", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 500);
    const held = new Set([setup.adminId]);
    const seen = await withUserLock(setup.adminId, async () => {
      expect(lockedOutside([setup.adminId], held)).toBe(false);
      return setup.s.analysis.get(setup.s, setup.adminId, "own", held);
    });
    expect(seen.ctx.txs.length).toBe(500);
    expect(await reprocess(repo, setup.s.settings)).toBeGreaterThan(0);
  });
});

/**
 * Holds the first read of a second history page of `userId` (a read in progress, its first page taken) until `release`
 * resolves; `reached` resolves when it is held.
 */
function holdSecondPage(setup: Setup, userId: string) {
  let reach!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((r) => (reach = r));
  const released = new Promise<void>((r) => (release = r));
  let armed = true;
  const all = setup.db.all.bind(setup.db);
  setup.db.all = (async (sql: string, params?: never[]) => {
    if (armed && /booking_date > \?/.test(sql) && params?.[0] === userId) {
      armed = false;
      reach();
      await released;
    }
    return all(sql, params);
  }) as typeof setup.db.all;
  return { reached, release };
}

describe("a reprocess writes in pieces and the analysis reads them whole", () => {
  it("the rows go in pieces with turns between them, and the version moves with the last piece", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 12_000);
    const pieces: boolean[] = [];
    const batch = setup.db.batch.bind(setup.db);
    setup.db.batch = async (statements) => {
      if (statements.some((st) => /UPDATE transactions SET/.test(st.sql))) pieces.push(statements.some((st) => /INSERT INTO settings/.test(st.sql) && st.params?.[0] === `data_version:${setup.adminId}`));
      return batch(statements);
    };
    expect(await reprocess(repo, setup.s.settings)).toBe(6000);
    expect(pieces).toEqual([false, false, true]);
  });

  it("a build that a reprocess wrote under while it read is read again after the run", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 12_000);
    await reprocess(repo, setup.s.settings);
    await repo.addRule({ field: "merchant_exact", pattern: "K-Market Kamppi", category: "restaurants", priority: 10 });
    const { reached, release } = holdSecondPage(setup, setup.adminId);
    // the build starts with no run going, reads its first page, and waits there while a whole run writes
    const cache = new AnalysisCache();
    const building = cache.get(setup.s, setup.adminId, "own");
    await reached;
    expect(lockedOutside([setup.adminId])).toBe(false);
    const run = reprocess(repo, setup.s.settings);
    while (!lockedOutside([setup.adminId])) await new Promise((r) => setImmediate(r));
    await run;
    release();
    expect((await building).ctx.txs.filter((t) => t.category === "restaurants")).toHaveLength(6000);
  });

  it("the analysis the after hook builds under the lock is the one served during the next run", async () => {
    const setup = await setupApp();
    const repo = await history(setup, 3000);
    // a statement bill: the after hook of a reprocess reads the analysis, under the lock
    await repo.saveStatement({ billId: "r000000", accountKey: "acc", periodFrom: "2026-01-01", periodTo: "2026-01-31", statementCents: 1000 }, [], "2026-10-09T10:00:00Z");
    await reprocess(repo, setup.s.settings);
    expect(setup.s.analysis.stats().entries).toBe(1);
    const built = await setup.s.analysis.get(setup.s, setup.adminId, "own");
    await repo.addRule({ field: "merchant_exact", pattern: "K-Market Kamppi", category: "restaurants", priority: 10 });
    const run = reprocess(repo, setup.s.settings);
    while (!lockedOutside([setup.adminId])) await new Promise((r) => setImmediate(r));
    expect(await setup.s.analysis.get(setup.s, setup.adminId, "own")).toBe(built);
    await run;
  });

  it("under a lock, a read that another member's run wrote under serves its caller and is not kept", async () => {
    const setup = await setupApp();
    const bertta = await setup.member("bertta");
    await history(setup, 6000);
    const theirs = await history(setup, 40, "b-y", bertta.id);
    expect((await bertta.call("PUT", `/api/accounts/b-y/shares/${setup.adminId}`)).status).toBe(200);
    const cache = new AnalysisCache();
    const { reached, release } = holdSecondPage(setup, setup.adminId);
    const seen = withUserLock(setup.adminId, () => cache.get(setup.s, setup.adminId, "household", new Set([setup.adminId])));
    await reached;
    // Bertta's run writes her rows while the read under the admin's lock waits on its second page
    await reprocess(theirs, setup.s.settings);
    release();
    expect((await seen).ctx.txs.length).toBe(6040);
    await new Promise((r) => setImmediate(r));
    expect(cache.stats().entries).toBe(0);
  });
});
