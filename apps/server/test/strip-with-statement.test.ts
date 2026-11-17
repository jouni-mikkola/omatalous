/**
 * The strip above Tapahtumat, its histogram and the front page tell one sum for a month, also when a card statement is
 * read: the purchases stand on their own days and the card bill at what its rows leave of it. The strip tells no sum
 * while its rows are newer than the figures it adds up.
 */
import { monthEnd } from "@banking/core";
import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

const PURCHASES = [
  { day: "2026-02-03", cents: 6150, text: "K-MARKET ESIMERKKI" },
  { day: "2026-02-09", cents: 8000, text: "ESIMERKKI POLTTOAINE" },
  { day: "2026-02-20", cents: 15000, text: "VERKKOKAUPPA ESIMERKKI" },
];

type Bin = { inCents: number; outCents: number };

/** A checking account with a salary in February and a card bill in March that pays February's purchases, the statement read. */
async function household() {
  const app = await setupApp();
  const { db, s, adminId } = app;
  for (const [id, type] of [["a-chk", "checking"], ["a-card", "credit_card"]] as const) {
    await s.finance(adminId).upsertAccount({ id, connectionId: null, provider: "csv", externalId: null, identity: null, name: id, bankName: id, holder: "Matti Meikalainen", iban: null, currency: "EUR", type } as never);
  }
  const tx = (id: string, date: string, cents: number, category: string, merchant: string) =>
    db.run(
      `INSERT INTO transactions (id, user_id, account_id, booking_date, amount_cents, currency, status, counterparty, merchant, category, category_source, is_transfer, source, imported_at)
       VALUES (?, ?, 'a-chk', ?, ?, 'EUR', 'booked', ?, ?, ?, 'rule', 0, 'csv', '2026-10-09T10:00:00Z')`,
      [id, adminId, date, cents, merchant, merchant, category],
    );
  await tx("salary", "2026-02-01", 250000, "salary", "TYONANTAJA OY");
  await tx("bill1", "2026-03-10", -42000, "card_bill", "ESIMERKKI KORTTI");
  const put = await app.admin.call("PUT", "/api/statements/bill1", { periodFrom: "2026-02-01", periodTo: "2026-02-28", statementCents: 42000, rows: PURCHASES });
  expect(put.status).toBe(200);
  const month = async (m: string) => {
    const range = `from=${m}-01&to=${monthEnd(m)}`;
    const strip = (await app.admin.call("GET", `/api/transactions?${range}&limit=1`)).body;
    const totals = (await app.admin.call("GET", `/api/dashboard?${range}&scope=own`)).body.totals;
    return { strip, totals };
  };
  return { ...app, tx, month };
}

const sumOf = (bins: Bin[], key: keyof Bin) => bins.reduce((n, b) => n + b[key], 0);

describe("the strip of Tapahtumat with a card statement read", () => {
  it("tells the front page's sums in the month of the purchases and in the month of the bill", async () => {
    const { month } = await household();
    for (const m of ["2026-01", "2026-02", "2026-03"]) {
      const { strip, totals } = await month(m);
      expect({ inCents: strip.inCents, outCents: strip.outCents, savedCents: strip.savedCents }, m).toEqual({ inCents: totals.incomeCents, outCents: totals.expenseCents, savedCents: totals.savedCents });
    }
    // the purchases of the statement are February's Menot, though the bill that paid them is booked in March
    expect((await month("2026-02")).strip.outCents).toBe(29150);
  });

  it("draws bars that add up to the strip, in a month and over the whole history", async () => {
    const { month, admin } = await household();
    for (const m of ["2026-02", "2026-03"]) {
      const { strip } = await month(m);
      const bins: Bin[] = strip.histogram.bins;
      expect(sumOf(bins, "outCents"), m).toBe(strip.outCents);
      expect(sumOf(bins, "inCents"), m).toBe(strip.inCents);
    }
    const whole = (await admin.call("GET", "/api/transactions?limit=1")).body;
    expect(sumOf(whole.histogram.bins, "outCents")).toBe(whole.outCents);
    expect(sumOf(whole.histogram.bins, "inCents")).toBe(whole.inCents);
    expect(whole.outCents).toBeGreaterThanOrEqual(29150);
  });

  it("leaves the statement's purchases out when a filter narrows the list", async () => {
    const { admin } = await household();
    const narrowed = (await admin.call("GET", "/api/transactions?from=2026-02-01&to=2026-02-28&category=salary&limit=10")).body;
    expect(narrowed.outCents).toBe(0);
    expect(narrowed.inCents).toBe(250000);
  });

  it("counts a listed bill whole when a filter narrows the list to it", async () => {
    const { admin } = await household();
    const march = (await admin.call("GET", "/api/transactions?from=2026-03-01&to=2026-03-31&accountId=a-chk&limit=10")).body;
    expect(march.outCents).toBe(42000);
    expect(sumOf(march.histogram.bins, "outCents")).toBe(42000);
    expect(march.daySums.map((d: { outCents: number }) => d.outCents)).toEqual([42000]);
    const byCategory = (await admin.call("GET", "/api/transactions?from=2026-03-01&to=2026-03-31&category=card_bill&limit=10")).body;
    expect(byCategory.outCents).toBe(42000);
  });

  it("tells no sum while a listed row is newer than the figures, and tells it once they are read again", async () => {
    const { month, tx, s, adminId, admin } = await household();
    expect((await month("2026-02")).strip.outCents).toBe(29150);
    // a row written without the version moving: the cached figures do not hold it yet
    await tx("late", "2026-02-12", -1000, "groceries", "K-MARKET ESIMERKKI");
    const range = "from=2026-02-01&to=2026-02-28";
    const stale = (await admin.call("GET", `/api/transactions?${range}&limit=10`)).body;
    expect(stale).toMatchObject({ total: 2, inCents: null, outCents: null, netCents: null, savedCents: null, histogram: null, daySums: [] });
    await s.settings.bumpUserDataVersion(adminId);
    const read = (await admin.call("GET", `/api/transactions?${range}&limit=10`)).body;
    expect(read.outCents).toBe(30150);
    expect(read.inCents).toBe(250000);
  });
});
