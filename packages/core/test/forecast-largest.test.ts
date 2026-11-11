import { describe, expect, it } from "vitest";
import { createContext, standingOf } from "../src/analysis/context.ts";
import { monthPace } from "../src/analysis/forecast.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const today: IsoDate = "2026-10-12";
const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

/** Prisma and the rent in each earlier month, so both are recurring series. */
const history = (): Transaction[] =>
  months.flatMap((m) => [
    tx({ bookingDate: `${m}-03` as IsoDate, amountCents: -7_500, merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: `${m}-17` as IsoDate, amountCents: -7_900, merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: `${m}-02` as IsoDate, amountCents: -90_000, merchant: "Vuokraovi Oy", category: "rent" }),
  ]);

describe("pace: the largest purchase", () => {
  const rows = [
    ...history(),
    tx({ bookingDate: "2026-10-02", amountCents: -90_000, merchant: "Vuokraovi Oy", category: "rent" }),
    tx({ bookingDate: "2026-10-08", amountCents: -8_000, merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: "2026-10-11", amountCents: -900, merchant: "Robert's Coffee", category: "restaurants", status: "pending" }),
  ];
  const ctx = createContext(rows, [checking], today);

  it("takes a shop's row although the shop is a recurring series", () => {
    expect(standingOf(ctx).recurring.some((s) => s.transactionIds.includes(rows.find((r) => r.bookingDate === "2026-10-08")!.id))).toBe(true);
    expect(monthPace(ctx, "2026-10", today).largest).toEqual({ day: 8, name: "Prisma", cents: 8_000 });
  });

  it("still skips a row of a fixed-cost series", () => {
    const rent = standingOf(ctx).recurring.find((s) => s.transactionIds.includes(rows.find((r) => r.bookingDate === "2026-10-02")!.id));
    expect(rent?.kind === "bill" || rent?.kind === "subscription").toBe(true);
    expect(monthPace(ctx, "2026-10", today).largest?.cents).not.toBe(90_000);
  });
});
