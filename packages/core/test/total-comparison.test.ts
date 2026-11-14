/**
 * The comparison of a month's total never locks on a card gap. A base month that holds a card's purchases only as a
 * bill still holds the whole total (the bill counts as spending), so the expected month, its band and the end of the
 * running month are there; only the days and the categories wait for months that hold the purchases. Made-up
 * households: pay, rent, and groceries and restaurants of 520 € together, which are on a card or paid by its bill.
 */
import { describe, expect, it } from "vitest";
import { missingCards } from "../src/analysis/card-bills.ts";
import { usualBase } from "../src/analysis/change-plan.ts";
import { createContext } from "../src/analysis/context.ts";
import { coversCategories, expectedFor, expectedSpending, usualGap } from "../src/analysis/expected.ts";
import { monthPace } from "../src/analysis/forecast.ts";
import { addMonths, dateIn } from "../src/dates.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { MIN_COMPARE_MONTHS } from "../src/thresholds.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-09";
const FIRST_MONTH = "2026-01";
const checking: Account = { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Morrow Bank Visa", bank: "Morrow Bank", iban: null, currency: "EUR", type: "credit_card" };
const range = { from: "2026-04-01", to: "2026-09-30" };

const row = (id: string, accountId: string, bookingDate: string, amountCents: number, counterparty: string, description: string | null = null): Transaction =>
  tx({ id, accountId, bookingDate, amountCents, counterparty, description, merchant: normalizeMerchant(counterparty, description) });

/** The months from January to the one of `TODAY`, with their index. */
function eachMonth(visit: (m: string, i: number) => void) {
  for (let m = FIRST_MONTH, i = 0; m <= TODAY.slice(0, 7); m = addMonths(m, 1), i++) visit(m, i);
}

/**
 * January to the 9th of October 2026. The card's own rows begin in `cardSince` (null: no card is connected). Every month
 * before October holds the card's bill on the checking account, which pairs with the card's payment row.
 */
function household(cardSince: string | null) {
  const out: Transaction[] = [];
  eachMonth((m, i) => {
    out.push(row(`rent-${i}`, "chk", dateIn(m, 2), -90_000, "ASUNTO OY ESIMERKKI", "VUOKRA"));
    out.push(row(`pay-${i}`, "chk", dateIn(m, 1), 300_000, "ESIMERKKI OY", "PALKKA"));
    const own = cardSince !== null && m >= cardSince;
    if (own) {
      out.push(row(`food-${i}`, "card", dateIn(m, 3), -40_000, "K-MARKET ESIMERKKI"));
      out.push(row(`dine-${i}`, "card", dateIn(m, 8), -12_000, "RAVINTOLA ESIMERKKI"));
    }
    if (m < TODAY.slice(0, 7)) {
      out.push(row(`bill-${i}`, "chk", dateIn(m, 24), -52_000, "MORROW BANK ASA", "LASKU"));
      if (own) out.push(row(`paid-${i}`, "card", dateIn(m, 24), 52_000, "SUORITUS", "SUORITUS"));
    }
  });
  const accounts = cardSince === null ? [checking] : [checking, card];
  return createContext(enrichTransactions(out, accounts, []), accounts, TODAY);
}

/** The card connected from the first month with its bills left as the bank paid them: a bill that pairs with none of the card's rows. */
function unmatchedBills() {
  const out: Transaction[] = [];
  eachMonth((m, i) => {
    out.push(tx({ id: `rent-${i}`, accountId: "chk", bookingDate: dateIn(m, 2), amountCents: -90_000, merchant: "Asunto Oy Esimerkki", category: "housing" }));
    out.push(tx({ id: `food-${i}`, accountId: "card", bookingDate: dateIn(m, 3), amountCents: -40_000, merchant: "K-Market Esimerkki", category: "groceries" }));
    out.push(tx({ id: `dine-${i}`, accountId: "card", bookingDate: dateIn(m, 8), amountCents: -12_000, merchant: "Ravintola Esimerkki", category: "restaurants" }));
    if (m < TODAY.slice(0, 7)) out.push(tx({ id: `bill-${i}`, accountId: "chk", bookingDate: dateIn(m, 24), amountCents: -52_000, merchant: "Morrow Bank", counterparty: "MORROW BANK ASA", category: "card_bill" }));
  });
  return createContext(out, [checking, card], TODAY);
}

/** What every case below shows: the month has an expected total and an estimate of its end, whatever the cards hold. */
function expectTotalComparison(ctx: ReturnType<typeof household>) {
  const figure = expectedFor(ctx, "2026-10")!;
  expect(figure).not.toBeNull();
  expect(figure.months.length).toBeGreaterThanOrEqual(MIN_COMPARE_MONTHS);
  expect(expectedSpending(ctx, "2026-10")).toBeGreaterThan(0);
  const pace = monthPace(ctx, "2026-10", TODAY);
  expect(pace.projection).not.toBeNull();
  const end = { low: pace.projection!.low.at(-1)!, high: pace.projection!.high.at(-1)! };
  expect(end.low).toBeGreaterThanOrEqual(pace.currentTotal);
  expect(end.high).toBeGreaterThanOrEqual(end.low);
  return { figure, pace };
}

describe("a card whose feed starts later than its bills", () => {
  const late = household("2026-07");
  const whole = household("2026-01");

  it("keeps the months before the feed as the base: the bill is the whole of their total", () => {
    expect(usualBase(late, "2026-10")).toContain("2026-04");
    expect(usualBase(late, "2026-10").length).toBeGreaterThanOrEqual(MIN_COMPARE_MONTHS);
  });

  it("compares the total and reads no day or category from the months that hold the card as a bill", () => {
    const { figure, pace } = expectTotalComparison(late);
    expect(figure.covered).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(coversCategories(figure)).toBe(false);
    expect(usualGap(late, "2026-10")).toBe("cards");
    expect(pace).toMatchObject({ expected: null, cardGap: true });
  });

  it("expects the same month as a card whose feed covers every month: a card's series is not put back over its bills", () => {
    expect(expectedSpending(late, "2026-10")).toBe(expectedSpending(whole, "2026-10"));
  });
});

describe("a card that is not connected", () => {
  it("compares the total: its bills are the spending of every base month", () => {
    const ctx = household(null);
    const { figure, pace } = expectTotalComparison(ctx);
    expect(figure.covered).toEqual([]);
    expect(pace).toMatchObject({ expected: null, cardGap: true });
    expect(expectedSpending(ctx, "2026-10")).toBe(expectedSpending(household("2026-01"), "2026-10"));
    expect(missingCards(ctx, range).bills.map((b) => b.reason)).toEqual(["not_connected"]);
  });
});

describe("a bill that pairs with none of the connected card's rows", () => {
  it("compares the total all the same", () => {
    const ctx = unmatchedBills();
    expect(missingCards(ctx, range).bills.map((b) => b.reason)).toEqual(["unmatched"]);
    expectTotalComparison(ctx);
  });
});

describe("a card whose rows cover every month", () => {
  it("is compared by total, day and category", () => {
    const ctx = household("2026-01");
    const { figure, pace } = expectTotalComparison(ctx);
    expect(coversCategories(figure)).toBe(true);
    expect(usualGap(ctx, "2026-10")).toBeNull();
    expect(pace.expected).not.toBeNull();
    expect(pace.cardGap).toBe(false);
  });
});
