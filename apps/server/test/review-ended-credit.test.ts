/**
 * Payments to a lender that stopped inside the twelve months are one row of Täydennä lainat (source `ended`): not a loan
 * proposal and not a card, asked once. "Maksettu pois" (a mark `in_use` on `question:credit-paid:<key>`) takes the row
 * away for good. Made-up lender and sums; the test clock is 9.10.2026.
 */
import { creditPaidSubject, type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";

const raw = (bookingDate: string, euros: number, counterparty: string, description: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description, reference: null, mcc: null,
});

/** A made-up lender debited in changing sums on the 5th from November 2025 to April 2026 (187 days before the clock), and a salary every month. */
const SUMS = [180, 420, 260, 510, 230, 390];
const rows = [
  ...["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"].map((m, i) => raw(`${m}-05`, -SUMS[i]!, "ESIMERKKIRAHOITUS OY", "LAINAN LYHENNYS")),
  ...["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) => raw(`${m}-15`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA")),
];

type Setup = Awaited<ReturnType<typeof setupApp>>;

/** The checking account `accountId` of the member `userId`, with the rows of the made-up lender and salary. */
async function addEndedRows(t: Setup, userId: string, accountId: string) {
  const repo = t.s.finance(userId);
  await repo.upsertAccount({ id: accountId, connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
  await ingestTransactions(repo, accountId, rows, "csv");
  await reprocess(repo, t.s.settings);
}

/** The debts Täydennä lainat lists for the signed-in member. */
async function debtsOf(caller: Setup["admin"]) {
  const list = ((await caller.call("GET", "/api/review")).body.items as { kind: string; debts?: { source: string; key: string; name: string; lastDate: string }[] }[]).find((i) => i.kind === "loan_terms_list");
  return list?.debts ?? [];
}

async function withEndedRows() {
  const t = await setupApp();
  await addEndedRows(t, t.adminId, "chk-1");
  return { ...t, debts: () => debtsOf(t.admin) };
}

describe("payments to a lender that stopped, in Täydennä lainat", () => {
  it("lists them once, with the day of the last payment, and not as a loan proposal", async () => {
    const t = await withEndedRows();
    expect(await t.debts()).toEqual([expect.objectContaining({ source: "ended", key: expect.stringMatching(/^out:chk-1:/), lastDate: "2026-04-05", kindUnknown: true })]);
    expect((await t.admin.call("GET", "/api/loans/proposals")).body).toEqual({ proposals: [] });
  });

  it("drops the row for good when the household says the credit is paid off", async () => {
    const t = await withEndedRows();
    const [row] = await t.debts();
    expect((await t.admin.call("PUT", "/api/marks", { subject: creditPaidSubject(row!.key), mark: "in_use" })).status).toBe(200);
    expect(await t.debts()).toEqual([]);
  });

  it("is the member's own: another member's payments, on an account shared with the first user or not, are asked only of them", async () => {
    const t = await setupApp();
    const ville = await t.member("ville", "Ville");
    await addEndedRows(t, ville.id, "v-chk");
    expect(await debtsOf(t.admin)).toEqual([]);
    await t.s.household.share(ville.id, "v-chk", t.adminId);
    expect(await debtsOf(t.admin)).toEqual([]);
    expect(await debtsOf(ville)).toEqual([expect.objectContaining({ source: "ended", key: expect.stringMatching(/^out:v-chk:/), lastDate: "2026-04-05" })]);
  });
});
