/**
 * The CSV import is gone, but households that used it keep accounts and rows with the source `csv`. These tests
 * seed such rows (csv-seed.ts) and pin that everything the app does with them is as before: nothing here may
 * change when the import code under test/ is removed too, only the way the rows are made.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seedCsv } from "./csv-seed.ts";
import { setupApp, waitFor } from "./helpers.ts";
import { HOLDER_IBAN, mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const HEAD = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const CHECKING = "FI21 1234 5600 0007 85"; // the fake bank's checking account (HOLDER_IBAN) with spaces
const SAVINGS = "FI45 1234 5600 0921 77";
const EMPLOYER = "FI98 1234 5600 0000 18";
const file = (...rows: string[]) => [HEAD, ...rows].join("\n");

const SALARY = `2026/09/25;3420,00;${EMPLOYER};${CHECKING};ACME OY;PALKKA;;EUR`;
const GROCERIES = `2026/09/05;-44,15;${CHECKING};;LIDL TIKKURILA;KORTTIOSTO;;EUR`;
const TRANSFER_IN = `2026/09/16;300,00;${CHECKING};${SAVINGS};TESTI ESIMERKKI;OMA SIIRTO;;EUR`;

type Item = { id: string; accountId: string; amountCents: number; category: string; isTransfer: boolean; description: string | null };

/** One old checking account from a file, and nothing else. */
async function oldAccount() {
  const t = await setupApp();
  const r = await seedCsv(t.s, t.admin, { content: file(SALARY, GROCERIES, `2026/09/03;-106,66;${CHECKING};;PRISMA TIKKURILA;KORTTIOSTO;;EUR`), accountName: "Vanha käyttötili", accountType: "checking" });
  expect(r.status).toBe(200);
  return { ...t, accountId: r.body.accountId as string };
}

/** The fake bank with its checking account's rows replaced, so the only pair on offer is the one the test makes. */
function bankWith(...rows: unknown[]) {
  const bank = mockBank();
  const row = (id: string, euros: string, dir: "CRDT" | "DBIT", date: string, text: string, party: object) => ({
    entry_reference: id,
    transaction_amount: { currency: "EUR", amount: euros },
    credit_debit_indicator: dir,
    status: "BOOK",
    booking_date: date,
    remittance_information: [text],
    ...party,
  });
  bank.answers["GET /accounts/u-chk/transactions"] = {
    status: 200,
    body: { transactions: [row("c1", "3420.00", "CRDT", "2026-09-25", "PALKKA", { debtor: { name: "ACME OY" } }), row("c3", "300.00", "DBIT", "2026-09-16", "OMA SIIRTO", { creditor: { name: "TESTI ESIMERKKI" } }), ...rows] },
  };
  bank.answers["GET /accounts/u-card/transactions"] = { status: 200, body: { transactions: [] } };
  return bank;
}

describe("old CSV rows: the route is gone, the rows are not", () => {
  it("a request to the import route answers 404 and makes no account", async () => {
    const { admin } = await setupApp();
    expect((await admin.call("POST", "/api/import/csv", { content: file(SALARY), accountName: "Uusi" })).status).toBe(404);
    expect((await admin.call("GET", "/api/meta")).body.accounts).toEqual([]);
  });

  it("are stored as source csv, on an account of the provider csv, and are categorised", async () => {
    const { admin, db, accountId } = await oldAccount();
    expect((await db.all<{ source: string }>("SELECT DISTINCT source FROM transactions")).map((r) => r.source)).toEqual(["csv"]);
    expect((await db.first<{ provider: string }>("SELECT provider FROM accounts WHERE id = ?", [accountId]))?.provider).toBe("csv");
    const items: Item[] = (await admin.call("GET", "/api/transactions?limit=50")).body.items;
    expect(items.map((t) => [t.amountCents, t.category]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
      [-10666, "groceries"],
      [-4415, "groceries"],
      [342000, "salary"],
    ]);
  });

  it("count in the dashboard and in the reports", async () => {
    const { admin } = await oldAccount();
    const totals = (await admin.call("GET", "/api/dashboard?from=2026-09-01&to=2026-09-30")).body.totals;
    expect(totals).toMatchObject({ incomeCents: 342000, expenseCents: 4415 + 10666 });
    const reports = (await admin.call("GET", "/api/reports?from=2026-09-01&to=2026-09-30&reports=cashflow")).body;
    expect(reports.cashflow.rows.find((r: { month: string }) => r.month === "2026-09")).toMatchObject({ incomeCents: 342000, consumptionCents: 4415 + 10666 });
  });

  it("pair with a bank account's row as a transfer, and count as saved", async () => {
    const bank = bankWith();
    const t = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const savings = await seedCsv(t.s, t.admin, { content: file(TRANSFER_IN), accountName: "Vanha säästötili", accountType: "savings" });
    expect(savings.status).toBe(200);
    await t.admin.call("POST", "/api/connections/start", {});
    await t.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    await waitFor(async () => (await t.admin.call("GET", "/api/sync/runs")).body.runs.some((r: { status: string }) => r.status !== "running"));

    const pair: Item[] = (await t.admin.call("GET", `/api/transactions?q=${encodeURIComponent("oma siirto")}&limit=50`)).body.items;
    expect(pair).toHaveLength(2);
    expect(pair.every((x) => x.isTransfer)).toBe(true);
    expect(pair.map((x) => x.amountCents).sort((a, b) => a - b)).toEqual([-30000, 30000]);
    expect(pair.filter((x) => x.accountId === savings.body.accountId)).toHaveLength(1);
    const provider = async (id: string) => (await t.db.first<{ provider: string }>("SELECT provider FROM accounts WHERE id = ?", [id]))?.provider;
    expect(await Promise.all(pair.map((x) => provider(x.accountId)))).toContain("csv");
    expect((await t.admin.call("GET", "/api/dashboard?from=2026-09-01&to=2026-09-30")).body.totals).toMatchObject({ incomeCents: 342000, savedCents: 30000 });
  });

  it("are not counted again by a bank sync over the same days", async () => {
    const bank = bankWith();
    const t = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const old = await seedCsv(t.s, t.admin, { content: file(SALARY, GROCERIES), accountName: "Vanha käyttötili" });
    expect(old.body).toMatchObject({ inserted: 2 });
    await t.admin.call("POST", "/api/connections/start", {});
    await t.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    await waitFor(async () => (await t.admin.call("GET", "/api/sync/runs")).body.runs.some((r: { status: string }) => r.status !== "running"));

    const accounts = (await t.admin.call("GET", "/api/meta")).body.accounts as { id: string; iban: string | null }[];
    expect(accounts.map((a) => a.id)).not.toContain(old.body.accountId);
    expect(accounts.filter((a) => a.iban === HOLDER_IBAN)).toHaveLength(1);
    const rows = async () => ((await t.admin.call("GET", "/api/transactions?from=2026-08-01&to=2026-10-09&limit=100")).body.items as Item[]).filter((x) => x.amountCents === 342000 || x.amountCents === -4415);
    expect(await rows()).toHaveLength(2);
    expect((await t.admin.call("POST", "/api/sync")).status).toBe(200);
    expect(await rows()).toHaveLength(2);
    expect((await t.admin.call("GET", "/api/dashboard?from=2026-09-01&to=2026-09-30")).body.totals).toMatchObject({ incomeCents: 342000, expenseCents: 4415 });
  });

  it("can be removed with their account", async () => {
    const { admin, db, accountId } = await oldAccount();
    expect((await admin.call("DELETE", `/api/accounts/${accountId}`)).body).toEqual({ ok: true });
    expect((await admin.call("GET", "/api/meta")).body.accounts).toEqual([]);
    expect((await admin.call("GET", "/api/transactions?limit=50")).body.items).toEqual([]);
    expect((await db.first<{ n: number }>("SELECT count(*) AS n FROM transactions WHERE account_id = ?", [accountId]))?.n).toBe(0);
  });

  it("are in the export", async () => {
    const { admin } = await oldAccount();
    const out = await admin.call("GET", "/api/export/transactions.csv?from=2026-09-01&to=2026-09-30");
    expect(out.status).toBe(200);
    const lines = (out.body as string).replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
    expect(lines).toHaveLength(1 + 3);
    expect(lines.filter((l) => l.includes("Vanha käyttötili"))).toHaveLength(3);
    expect(lines.some((l) => l.includes("3420") && l.includes("ACME"))).toBe(true);
    expect(lines.some((l) => l.includes("-44,15"))).toBe(true);
  });
});
