import { describe, expect, it } from "vitest";
import type { FinanceRepo, TransactionFilter } from "../src/db/finance-repo.ts";
import type { StoredTransaction } from "../src/db/rows.ts";
import { setupApp } from "./helpers.ts";

type Setup = Awaited<ReturnType<typeof setupApp>>;

async function addAccount(repo: FinanceRepo, id: string) {
  await repo.upsertAccount({ id, connectionId: null, provider: "csv", externalId: null, identity: id, name: id, iban: null, currency: "EUR", type: "checking" });
}

/** Rows on few dates so that many share a day: the id has to break every tie, also across page borders. */
function rowsFor(accountId: string, prefix: string, count: number): Omit<StoredTransaction, "userId">[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${String(i).padStart(5, "0")}`,
    accountId,
    bookingDate: `2026-0${1 + (i % 6)}-${String(1 + (i % 3)).padStart(2, "0")}`,
    valueDate: null,
    amountCents: i % 4 === 0 ? 1000 + i : -(100 + i),
    currency: "EUR",
    status: "booked" as const,
    counterparty: null,
    counterpartyIban: null,
    description: `rivi ${i}`,
    reference: null,
    mcc: null,
    merchant: i % 5 === 0 ? "Harvinainen" : `Kauppa ${i % 7}`,
    category: i % 2 ? "groceries" : "other",
    categorySource: "default" as const,
    isTransfer: false,
    source: "test",
    raw: JSON.stringify({ secret: "payload" }),
  }));
}

async function seed({ s, adminId }: Setup, count: number) {
  const repo = s.finance(adminId);
  await addAccount(repo, "acc-own");
  await repo.batch(repo.upsertStatements(rowsFor("acc-own", "own", count), "2026-10-09T10:00:00Z"));
  return repo;
}

describe("transaction list and export paging", () => {
  it("export pages by the last row and returns every row once, in the list's order", async () => {
    const setup = await setupApp();
    const repo = await seed(setup, 230);
    const filter: TransactionFilter = { from: "2026-01-01", to: "2026-12-31" };
    const expected = (await repo.listTransactions({ ...filter, limit: 5000 })).items.map((t) => t.id);
    expect(expected).toHaveLength(230);
    for (const size of [1, 7, 50, 229, 230, 1000]) {
      const seen: string[] = [];
      for (let after: { date: string; id: string } | undefined; ; ) {
        const page = await repo.exportPage(filter, undefined, size, after);
        seen.push(...page.map((t) => t.id));
        if (page.length < size) break;
        after = { date: page[page.length - 1]!.bookingDate, id: page[page.length - 1]!.id };
      }
      expect(seen, `page size ${size}`).toEqual(expected);
    }
  });

  it("applies the filters in the export pages as in the list", async () => {
    const setup = await setupApp();
    const repo = await seed(setup, 120);
    for (const filter of [{ merchant: "Harvinainen" }, { category: "groceries", from: "2026-02-01" }, { q: "rivi 1", to: "2026-04-30" }, { accountId: "acc-own" }]) {
      const listed = (await repo.listTransactions({ ...filter, limit: 5000 })).items.map((t) => t.id);
      const paged: string[] = [];
      for (let after: { date: string; id: string } | undefined; ; ) {
        const page = await repo.exportPage(filter, undefined, 5, after);
        paged.push(...page.map((t) => t.id));
        if (page.length < 5) break;
        after = { date: page[page.length - 1]!.bookingDate, id: page[page.length - 1]!.id };
      }
      expect(paged, JSON.stringify(filter)).toEqual(listed);
      expect(listed.length).toBeGreaterThan(0);
    }
  });

  it("the household list is the merge of own and shared rows with the right totals, offsets and pages", async () => {
    const setup = await setupApp();
    const own = await seed(setup, 60);
    const eero = await setup.member("eero");
    const theirs = setup.s.finance(eero.id);
    await addAccount(theirs, "acc-eero");
    await theirs.batch(theirs.upsertStatements(rowsFor("acc-eero", "eer", 45), "2026-10-09T10:00:00Z"));
    await addAccount(theirs, "acc-eero-private");
    await theirs.batch(theirs.upsertStatements(rowsFor("acc-eero-private", "pri", 10), "2026-10-09T10:00:00Z"));
    expect(await setup.s.household.share(eero.id, "acc-eero", setup.adminId)).toBe(true);

    const all = [...rowsFor("acc-own", "own", 60), ...rowsFor("acc-eero", "eer", 45)].sort((a, b) => b.bookingDate.localeCompare(a.bookingDate) || (a.id < b.id ? -1 : 1));
    const view = await own.listTransactions({ limit: 5000 }, ["acc-eero"]);
    expect(view.items.map((t) => t.id)).toEqual(all.map((t) => t.id));
    expect(view.total).toBe(105);
    expect(view.inCents).toBe(all.filter((t) => t.amountCents > 0).reduce((n, t) => n + t.amountCents, 0));
    expect(view.outCents).toBe(-all.filter((t) => t.amountCents < 0).reduce((n, t) => n + t.amountCents, 0));
    for (const [limit, offset] of [[10, 0], [10, 95], [25, 40], [200, 0], [7, 100]] as const) {
      const page = await own.listTransactions({ limit, offset }, ["acc-eero"]);
      expect(page.items.map((t) => t.id), `limit ${limit} offset ${offset}`).toEqual(all.slice(offset, offset + limit).map((t) => t.id));
    }
    // no shared accounts in view: own rows only, and another member's private account never shows
    expect((await own.listTransactions({ limit: 5000 }, [])).total).toBe(60);
    expect((await own.listTransactions({ limit: 5000 }, ["acc-eero"])).items.some((t) => t.accountId === "acc-eero-private")).toBe(false);
    // the export walks the same merged order
    const exported: string[] = [];
    for (let after: { date: string; id: string } | undefined; ; ) {
      const page = await own.exportPage({}, ["acc-eero"], 13, after);
      exported.push(...page.map((t) => t.id));
      if (page.length < 13) break;
      after = { date: page[page.length - 1]!.bookingDate, id: page[page.length - 1]!.id };
    }
    expect(exported).toEqual(all.map((t) => t.id));
  });

  it("does not read the bank's raw payload", async () => {
    const setup = await setupApp();
    const repo = await seed(setup, 3);
    expect((await repo.listTransactions({})).items.every((t) => t.raw === null)).toBe(true);
    expect((await repo.getTransaction("own00001"))?.raw).toBeNull();
    expect((await repo.exportPage({}, undefined, 10)).every((t) => t.raw === null)).toBe(true);
    // the payload is still stored
    expect((await setup.db.first<{ raw: string }>("SELECT raw FROM transactions WHERE id = 'own00001'"))?.raw).toContain("payload");
  });

  it("the CSV export over several pages has every row once, with the header first", async () => {
    const setup = await setupApp();
    await seed(setup, 4300);
    const res = await setup.admin.call("GET", "/api/export/transactions.csv?from=2026-01-01&to=2026-12-31");
    expect(res.status).toBe(200);
    const lines = String(res.body).replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe("Päivä;Tili;Kauppias;Saaja/maksaja;Viesti;Kategoria;Ryhmä;Summa €;Tila;Lähde;Siirto");
    expect(lines).toHaveLength(4301);
    expect(new Set(lines.slice(1).map((l) => l.split(";").slice(0, 8).join(";"))).size).toBe(lines.length - 1);
    const dates = lines.slice(1).map((l) => l.split(";")[0]!);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(String(res.body)).not.toContain("payload");
  });
});

describe("indexes of the list", () => {
  async function plan(sql: string, params: string[]) {
    const { s } = await setupApp();
    return (await s.db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)).map((r) => r.detail).join("\n");
  }

  it("count and sum over a date range come from the index alone", async () => {
    const p = await plan("SELECT COUNT(*), SUM(amount_cents) FROM transactions WHERE user_id = ? AND booking_date >= ? AND booking_date <= ?", ["u", "2026-01-01", "2026-12-31"]);
    expect(p).toContain("USING COVERING INDEX idx_tx_user_date_amount");
  });

  it("one merchant newest first walks its own rows", async () => {
    const p = await plan("SELECT id FROM transactions WHERE user_id = ? AND merchant = ? ORDER BY booking_date DESC, id LIMIT 100", ["u", "Kauppa"]);
    expect(p).toContain("idx_tx_user_merchant_date");
    expect(p).not.toContain("TEMP B-TREE");
  });

  it("one category newest first walks its own rows", async () => {
    const p = await plan("SELECT id FROM transactions WHERE user_id = ? AND category = ? ORDER BY booking_date DESC, id LIMIT 100", ["u", "groceries"]);
    expect(p).toContain("idx_tx_user_category_date");
    expect(p).not.toContain("TEMP B-TREE");
  });
});
