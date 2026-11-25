/**
 * The lead of Tapahtumat (reports/month-lead.ts): the biggest day of the running month, its top payees and the new ones.
 * Made-up rows on one account.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { UNKNOWN_MERCHANT } from "../src/merchant.ts";
import { monthLeadReport } from "../src/reports/month-lead.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-20";
const account: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const buy = (bookingDate: string, merchant: string, cents: number): Transaction => tx({ bookingDate, amountCents: -cents, merchant, category: "groceries" });
const leadOf = (rows: Transaction[]) => monthLeadReport(createContext([...rows].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate)), [account], today));

describe("the lead of the running month", () => {
  const rows = [
    buy("2026-08-15", "K-Market", 2000),
    buy("2026-09-10", "K-Market", 3000),
    buy("2026-10-02", "K-Market", 4000),
    buy("2026-10-05", "Uusi Kauppa", 9000),
    buy("2026-10-05", "K-Market", 1000),
    buy("2026-10-12", "K-Market", 2500),
  ];

  it("names the biggest day with its sum and row count", () => {
    expect(leadOf(rows).biggestDay).toEqual({ date: "2026-10-05", outCents: 10000, count: 2 });
  });

  it("lists the payees that took most, largest first", () => {
    expect(leadOf(rows).top).toEqual([
      { merchant: "Uusi Kauppa", outCents: 9000 },
      { merchant: "K-Market", outCents: 7500 },
    ]);
  });

  it("lists only payees with no row before the month as new", () => {
    expect(leadOf(rows).fresh).toEqual([{ merchant: "Uusi Kauppa", outCents: 9000 }]);
  });

  it("calls nothing new while the history does not reach the month before", () => {
    expect(leadOf(rows.filter((r) => r.bookingDate >= "2026-10-01")).fresh).toEqual([]);
  });

  it("counts only the rows of the biggest day that spent money, not income or transfers", () => {
    const day = "2026-10-05";
    const more = [
      ...rows,
      tx({ bookingDate: day, amountCents: 150_000, merchant: "Työnantaja", category: "salary" }),
      tx({ bookingDate: day, amountCents: -50_000, merchant: "Säästötili", category: "transfer", isTransfer: true }),
    ];
    expect(leadOf(more).biggestDay).toEqual({ date: day, outCents: 10000, count: 2 });
  });

  it("leaves money to a person, debt payments and unknown payees out of the payees", () => {
    const more = [
      ...rows,
      tx({ bookingDate: "2026-10-06", amountCents: -80_000, merchant: "Matti Meikäläinen", counterparty: "MATTI MEIKÄLÄINEN", description: "MobilePay", category: "other" }),
      tx({ bookingDate: "2026-10-07", amountCents: -90_000, merchant: "Asuntolaina", category: "mortgage" }),
      tx({ bookingDate: "2026-10-08", amountCents: -70_000, merchant: UNKNOWN_MERCHANT, category: "other" }),
    ];
    const { top, fresh } = leadOf(more);
    for (const name of ["Matti Meikäläinen", "Asuntolaina", UNKNOWN_MERCHANT]) {
      expect(top.map((p) => p.merchant)).not.toContain(name);
      expect(fresh.map((p) => p.merchant)).not.toContain(name);
    }
    expect(top.map((p) => p.merchant)).toEqual(["Uusi Kauppa", "K-Market"]);
  });

  it("has no day while the month has no spending", () => {
    expect(leadOf(rows.filter((r) => r.bookingDate < "2026-10-01"))).toMatchObject({ month: "2026-10", biggestDay: null, top: [], fresh: [] });
  });
});
