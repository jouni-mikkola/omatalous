import { detectRecurring, type Transaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { comingThisMonth } from "../src/coming.ts";

const rows = (merchant: string, dates: string[], amountCents: number): Transaction[] =>
  dates.map((bookingDate, i) => ({
    id: `${merchant}-${i}`,
    accountId: "acc-1",
    bookingDate,
    amountCents,
    currency: "EUR",
    status: "booked",
    counterparty: merchant,
    counterpartyIban: null,
    description: merchant,
    mcc: null,
    merchant,
    category: "subscriptions",
    categorySource: "rule",
    isTransfer: false,
  }));

describe("Toistuvat: Tulossa tässä kuussa", () => {
  it("keeps the projected date of a charge a few days late from last month, and counts every weekly date", () => {
    const today = "2026-10-03";
    const monthly = ["2026-01-29", "2026-02-27", "2026-03-30", "2026-04-29", "2026-05-29", "2026-06-29", "2026-07-29", "2026-08-28"];
    const weekly = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 4, 15 + 7 * i)).toISOString().slice(0, 10));
    const series = detectRecurring([...rows("Lehti", monthly, -1500), ...rows("Viikkolehti", weekly, -400)], today).map(({ transactionIds: _ids, ...s }) => s);
    const late = series.find((s) => s.merchant === "Lehti")!;
    expect(late).toMatchObject({ active: true, overdue: false });
    expect(late.nextDate! < "2026-10-01").toBe(true);

    const coming = comingThisMonth(series, today, new Set());
    const lehti = coming.filter((c) => c.merchant === "Lehti").map((c) => c.date);
    // the real date, not the 1st
    expect(lehti[0]).toBe(late.nextDate);
    expect(coming.filter((c) => c.merchant === "Viikkolehti").length).toBeGreaterThanOrEqual(4);
    expect(comingThisMonth(series, today, new Set(["Lehti"])).some((c) => c.merchant === "Lehti")).toBe(false);
  });
});
