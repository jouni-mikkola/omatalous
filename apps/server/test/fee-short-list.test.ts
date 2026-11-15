/**
 * A payment between two accounts of the household that arrived a fee short: Pankkikulut counts the fee, and the link of
 * Pankkikulut (Tapahtumat with the category, its sums and its CSV) holds rows that add up to the same figure, while
 * the payment itself is listed whole as the transfer it is.
 */
import type { RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { ingestTransactions } from "../src/services/ingest.ts";
import { reprocess } from "../src/services/enrich.ts";
import { type Client, setupApp } from "./helpers.ts";

const [CHECKING_IBAN, SAVINGS_IBAN] = ["FI2112345600000785", "FI4950009420028730"];
const SEPTEMBER = "from=2026-09-01&to=2026-09-30";

const raw = (bookingDate: string, euros: number, extra: Partial<RawTransaction> = {}): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty: null, counterpartyIban: null, description: null, reference: null, mcc: null, ...extra,
});

async function household() {
  const app = await setupApp();
  const repo = app.s.finance(app.adminId);
  for (const [id, iban] of [["checking", CHECKING_IBAN], ["savings", SAVINGS_IBAN]] as const) {
    await repo.upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: null, identity: `idn-${id}`, name: id, holder: null, iban, currency: "EUR", type: "checking" });
  }
  await ingestTransactions(repo, "checking", [raw("2026-09-10", -81.5, { counterpartyIban: SAVINGS_IBAN, description: "Siirto" }), raw("2026-09-12", -20, { counterparty: "KAUPPA OY", mcc: "5411" })], "enablebanking");
  await ingestTransactions(repo, "savings", [raw("2026-09-11", 80, { description: "Siirto" })], "enablebanking");
  await reprocess(repo, app.s.settings);
  return app;
}

/** The figures the page of Pankkikulut reads: the category report's, and the fee-category link's rows, sums and CSV. */
async function feeFigures(client: Client) {
  const reports = (await client.call("GET", `/api/reports?${SEPTEMBER}`)).body;
  const stats = (reports.categories.groups as { categories: { category: string; totalCents: number }[] }[]).flatMap((g) => g.categories);
  const list = (await client.call("GET", `/api/transactions?${SEPTEMBER}&category=fees&limit=500`)).body;
  const csv: string = (await client.call("GET", `/api/export/transactions.csv?${SEPTEMBER}&category=fees`)).body;
  const csvRows = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean).slice(1).map((line) => line.split(";"));
  return { report: stats.find((s) => s.category === "fees")?.totalCents ?? 0, list, csvRows };
}

describe("a payment that arrived a fee short, in Pankkikulut", () => {
  it("the rows of its link add up to the figure: the list, its sums and the CSV count the fee, and the payment is listed whole as a transfer", async () => {
    const app = await household();
    const { report, list, csvRows } = await feeFigures(app.admin);
    expect(report).toBe(150);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ amountCents: -8150, partCents: -150, isTransfer: true, category: "fees" });
    expect(list.items.reduce((n: number, t: { partCents: number }) => n - t.partCents, 0)).toBe(report);
    expect([list.inCents, list.outCents]).toEqual([0, report]);
    expect(list.daySums).toEqual([{ date: "2026-09-10", count: 1, inCents: 0, outCents: report }]);
    expect(csvRows).toHaveLength(1);
    expect(csvRows[0]![7]).toBe("-1,5");
    expect(-Number(csvRows[0]![7]!.replace(",", ".")) * 100).toBe(report);
  });

  it("the month's list counts the fee and the purchase, and neither leg of the pair as money", async () => {
    const app = await household();
    const list = (await app.admin.call("GET", `/api/transactions?${SEPTEMBER}&limit=500`)).body;
    expect([list.inCents, list.outCents]).toEqual([0, 2150]);
  });

  it("near miss: between two members, where the sender's view holds one leg only, nothing is spending under Pankkikulut and nothing is listed there", async () => {
    const app = await setupApp();
    const eero = await app.member("eero", "Eero");
    const [sender, receiver] = [app.s.finance(app.adminId), app.s.finance(eero.id)];
    for (const [repo, id, iban] of [[sender, "checking", CHECKING_IBAN], [receiver, "savings", SAVINGS_IBAN]] as const) {
      await repo.upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: null, identity: `idn-${id}`, name: id, holder: null, iban, currency: "EUR", type: "checking" });
    }
    await ingestTransactions(sender, "checking", [raw("2026-09-10", -81.5, { counterpartyIban: SAVINGS_IBAN, description: "Siirto" })], "enablebanking");
    await ingestTransactions(receiver, "savings", [raw("2026-09-11", 80, { description: "Siirto" })], "enablebanking");
    await reprocess(sender, app.s.settings);
    await reprocess(receiver, app.s.settings);
    for (const client of [app.admin, eero]) {
      const { report, list, csvRows } = await feeFigures(client);
      expect([report, list.items.length, csvRows.length]).toEqual([0, 0, 0]);
    }
  });

  it("near miss: the same payment with both legs whole has no fee, and no row under Pankkikulut", async () => {
    const app = await setupApp();
    const repo = app.s.finance(app.adminId);
    for (const [id, iban] of [["checking", CHECKING_IBAN], ["savings", SAVINGS_IBAN]] as const) {
      await repo.upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: null, identity: `idn-${id}`, name: id, holder: null, iban, currency: "EUR", type: "checking" });
    }
    await ingestTransactions(repo, "checking", [raw("2026-09-10", -80, { counterpartyIban: SAVINGS_IBAN, description: "Siirto" })], "enablebanking");
    await ingestTransactions(repo, "savings", [raw("2026-09-11", 80, { description: "Siirto" })], "enablebanking");
    await reprocess(repo, app.s.settings);
    const { report, list, csvRows } = await feeFigures(app.admin);
    expect([report, list.items.length, csvRows.length]).toEqual([0, 0, 0]);
  });
});
