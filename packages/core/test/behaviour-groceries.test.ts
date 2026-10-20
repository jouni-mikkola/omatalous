/**
 * Grocery days and basket (behaviour/groceries.ts): a day with a grocery purchase is a shopping day, one shop on one
 * day is one visit, the mean basket needs four visits, and a kiosk is counted apart.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { behaviourOf } from "../src/behaviour/index.ts";
import { addDays, dateIn } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const TODAY = "2026-10-14";
const MONDAY = "2026-10-12";
const TUESDAY = "2026-10-13";

const paid = (bookingDate: string, cents: number, merchant: string, category = "groceries") => tx({ bookingDate, amountCents: -cents, merchant, category, categorySource: "rule" });
const rent = Array.from({ length: 10 }, (_, i) => paid(dateIn(`2026-${String(i + 1).padStart(2, "0")}`, 2), 45_000, "Asunto Oy Esimerkki", "housing"));
const world = (rows: readonly Transaction[]) => behaviourOf(createContext([...rent, ...rows], [checking], TODAY)).groceries;

describe("grocery visits", () => {
  it("the same shop twice a day is one visit", () => {
    const g = world([paid(MONDAY, 1_200, "Esimerkkikauppa"), paid(MONDAY, 800, "Esimerkkikauppa")]);
    expect(g.week).toMatchObject({ days: 1, visits: 1 });
    expect(g.evidenceIds).toHaveLength(2);
  });

  it("two shops the same day are one day and two visits", () => {
    const g = world([paid(MONDAY, 1_200, "Esimerkkikauppa"), paid(MONDAY, 800, "Toinen Market")]);
    expect(g.week).toMatchObject({ days: 1, visits: 2 });
  });

  it("the mean basket needs four visits", () => {
    const three = world([paid(MONDAY, 1_000, "A-kauppa"), paid(MONDAY, 2_000, "B-kauppa"), paid(TUESDAY, 3_000, "A-kauppa")]);
    expect(three.week.basketCents).toBeNull();
    const four = world([paid(MONDAY, 1_000, "A-kauppa"), paid(MONDAY, 2_000, "B-kauppa"), paid(TUESDAY, 3_000, "A-kauppa"), paid(TODAY, 4_001, "A-kauppa")]);
    expect(four.week).toMatchObject({ days: 3, visits: 4, basketCents: 2_500 });
  });

  it("a kiosk is counted apart from the shop visits", () => {
    const g = world([paid(MONDAY, 3_000, "Esimerkkikauppa"), paid(MONDAY, 450, "R-Kioski Keskusta"), paid(TUESDAY, 300, "R-KIOSKI")]);
    expect(g.week).toMatchObject({ days: 1, visits: 1, kioskVisits: 2 });
  });

  it("a grill kiosk filed under groceries is a visit, not a kiosk", () => {
    const g = world([paid(MONDAY, 1_200, "Grillikioski Esimerkki")]);
    expect(g.week).toMatchObject({ visits: 1, kioskVisits: 0 });
  });

  it("says the days are booking days", () => {
    expect(world([]).dayKind).toBe("booking");
  });

  it("shopping days 2 above the usual of covered weeks are above usual", () => {
    const usual = Array.from({ length: 26 }, (_, k) => paid(addDays(MONDAY, -7 * (k + 1) + 2), 3_000 + k, "Esimerkkikauppa"));
    const g = world([...usual, paid(MONDAY, 2_000, "Esimerkkikauppa"), paid(TUESDAY, 2_000, "Esimerkkikauppa"), paid(TODAY, 2_000, "Esimerkkikauppa")]);
    expect([g.week.days, g.usual, g.above]).toEqual([3, 1, true]);
  });

  it("a payment to a person filed under groceries is no visit", () => {
    const g = world([tx({ bookingDate: MONDAY, amountCents: -1_500, merchant: "MobilePay Maija", counterparty: "Maija Meikäläinen", description: "MobilePay", category: "groceries", categorySource: "rule" })]);
    expect(g.week.visits).toBe(0);
  });
});
