/**
 * Rows of a card statement file (ADR 0025): the route takes rows and no file, the same statement twice stores each row
 * once, a card bill paid from the checking account is matched to the card's payment row, and the purchases count as spending.
 */
import { readCardFile, type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { ingestTransactions } from "../src/services/ingest.ts";
import { reprocess } from "../src/services/enrich.ts";
import { setupApp } from "./helpers.ts";

// the test clock is 2026-10-09
const STATEMENT = [
  "Kortti;**** 1234",
  "Ostopäivä;Kirjauspäivä;Kauppa;Summa",
  "03.09.2026;04.09.2026;PRISMA TIKKURILA;23,40",
  "05.09.2026;06.09.2026;SUSHIBAR HELSINKI;41,20",
  "28.09.2026;28.09.2026;Maksu kiitos;-64,60",
].join("\n");

const body = () => {
  const r = readCardFile(STATEMENT);
  if (!r.ok) throw new Error(r.error);
  return { name: "Visa", last4: r.cardLast4, rows: r.rows.map(({ day, cents, text }) => ({ day, cents, text })) };
};

type Item = { accountId: string; amountCents: number; isTransfer: boolean; category: string; description: string | null; counterparty: string | null };

describe("card statement rows", () => {
  it("store the rows on a card account of their own", async () => {
    const { admin } = await setupApp();
    const r = await admin.call("POST", "/api/card-file", body());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ fetched: 3, inserted: 3, skipped: 0 });
    const account = (await admin.call("GET", "/api/meta")).body.accounts.find((a: { id: string }) => a.id === r.body.accountId);
    expect(account).toMatchObject({ provider: "cardfile", type: "credit_card" });
    const items: Item[] = (await admin.call("GET", "/api/transactions?from=2026-09-01&to=2026-09-30&limit=50")).body.items;
    expect(items.map((x) => x.amountCents).sort((a, b) => a - b)).toEqual([-4120, -2340, 6460]);
  });

  it("store each row once when the same statement is read twice", async () => {
    const { admin, db } = await setupApp();
    const first = await admin.call("POST", "/api/card-file", body());
    const again = await admin.call("POST", "/api/card-file", body());
    expect(again.body).toMatchObject({ accountId: first.body.accountId, inserted: 0, changed: 0 });
    expect((await db.first<{ n: number }>("SELECT count(*) AS n FROM transactions"))?.n).toBe(3);
  });

  it("match a card bill to the card's payment, so the purchases are the spending", async () => {
    const { admin, adminId, s } = await setupApp();
    const repo = s.finance(adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "enablebanking", externalId: "c", identity: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" });
    const bill: RawTransaction = { externalId: "bill-1", bookingDate: "2026-09-29", valueDate: null, amountCents: -6460, currency: "EUR", status: "booked", counterparty: "NORDEA RAHOITUS", counterpartyIban: null, description: "KORTTILASKU", reference: null, mcc: null };
    await ingestTransactions(repo, "chk", [bill], "enablebanking");
    await reprocess(repo, s.settings);
    await admin.call("POST", "/api/card-file", body());
    const items: Item[] = (await admin.call("GET", "/api/transactions?from=2026-09-01&to=2026-09-30&limit=50")).body.items;
    const payments = items.filter((x) => Math.abs(x.amountCents) === 6460);
    expect(payments).toHaveLength(2);
    expect(payments.every((x) => x.isTransfer)).toBe(true);
    expect(items.filter((x) => x.accountId !== "chk" && x.amountCents < 0).every((x) => !x.isTransfer)).toBe(true);
    const totals = (await admin.call("GET", "/api/dashboard?from=2026-09-01&to=2026-09-30")).body.totals;
    expect(totals).toMatchObject({ expenseCents: 2340 + 4120 });
  });

  it("refuse a bank's account, rows from the future and a body that holds more than rows", async () => {
    const { admin, adminId, s } = await setupApp();
    await s.finance(adminId).upsertAccount({ id: "chk", connectionId: null, provider: "enablebanking", externalId: "c", identity: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
    expect((await admin.call("POST", "/api/card-file", { ...body(), accountId: "chk" })).status).toBe(400);
    expect((await admin.call("POST", "/api/card-file", { rows: [{ day: "2026-12-01", cents: -100, text: "X" }] })).status).toBe(400);
    expect((await admin.call("POST", "/api/card-file", { ...body(), file: "Ostopäivä;..." })).status).toBe(400);
    expect((await admin.call("POST", "/api/card-file", { rows: [] })).status).toBe(400);
  });

  it("can be removed with their account", async () => {
    const { admin } = await setupApp();
    const r = await admin.call("POST", "/api/card-file", body());
    expect((await admin.call("DELETE", `/api/accounts/${r.body.accountId}`)).body).toEqual({ ok: true });
    expect((await admin.call("GET", "/api/transactions?limit=50")).body.items).toEqual([]);
  });
});
