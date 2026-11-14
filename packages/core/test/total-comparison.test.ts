/**
 * The comparison of a month's total never locks on a card gap. A base month that holds a card's purchases only as a
 * bill still holds the whole total (the bill counts as spending), so the expected month, its band and the end of the
 * running month are there; only the days and the categories wait for months that hold the purchases. Made-up
 * households: pay, rent, and groceries and restaurants of 520 € together, which are on a card or paid by its bill.
 */
import { describe, expect, it } from "vitest";
import { missingCards } from "../src/analysis/card-bills.ts";
import { spendingChange } from "../src/analysis/change.ts";
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

describe("the running month's change report by days", () => {
  it("waits while a base month holds a card as a bill: that month has none of the card's purchases by today's day", () => {
    const late = household("2026-07");
    // by the 9th the three bill months hold the rent alone (90 000) and the three later ones the rent and the card (142 000): a mean of 116 000 against 142 000 would be a rise of 26 000 that no one caused
    expect(spendingChange(late, "expected", "2026-10")).toBeNull();
    // the whole month needs no day: every base month spent 142 000, and the month so far has spent 142 000
    expect(expectedSpending(late, "2026-10")).toBe(142_000);
    expect(monthPace(late, "2026-10", TODAY).currentTotal).toBe(142_000);
  });

  it("is there when the card's rows cover every base month", () => {
    expect(spendingChange(household("2026-01"), "expected", "2026-10")).toMatchObject({ nowCents: 142_000, baseCents: 142_000, changeCents: 0 });
  });
});

/**
 * Two cards: A's rows begin in January, B's in July, so April to June hold B as a bill (13 500 a month) and A as rows.
 * A pays an insurance of 60 € a month from June, B one of 15 € from July. A's series is put back into April and May,
 * B's is not (its bills hold it). Rows carry their categories, so no rule of the pipeline decides the figures.
 */
function twoCards() {
  const cardA: Account = { id: "card-a", name: "Morrow Bank Visa", bank: "Morrow Bank", iban: null, currency: "EUR", type: "credit_card" };
  const cardB: Account = { id: "card-b", name: "Other Bank Mastercard", bank: "Other Bank", iban: null, currency: "EUR", type: "credit_card" };
  const out: Transaction[] = [];
  const add = (id: string, accountId: string, m: string, day: number, cents: number, merchant: string, category: string) =>
    out.push(tx({ id, accountId, bookingDate: dateIn(m, day), amountCents: -cents, merchant, category }));
  eachMonth((m, i) => {
    add(`rent-${i}`, "chk", m, 2, 90_000, "Asunto Oy Esimerkki", "housing");
    add(`food-${i}`, "card-a", m, 3, 40_000, "K-Market Esimerkki", "groceries");
    if (m >= "2026-06") add(`ins-a-${i}`, "card-a", m, 5, 6_000, "Vakuutus Esimerkki", "insurance");
    if (m >= "2026-07") {
      add(`dine-${i}`, "card-b", m, 3, 12_000, "Ravintola Esimerkki", "restaurants");
      add(`ins-b-${i}`, "card-b", m, 7, 1_500, "Toinen Vakuutus Esimerkki", "insurance");
    } else add(`bill-${i}`, "chk", m, 24, 13_500, "Other Bank", "card_bill");
  });
  return createContext(out, [checking, cardA, cardB], TODAY);
}

describe("two cards, only one with a gap", () => {
  const ctx = twoCards();
  const figure = expectedFor(ctx, "2026-10")!;
  const of = (category: string) => figure.at().categories.find((c) => c.category === category)?.cents;

  it("reads April to September, April to June holding B as a bill", () => {
    expect(figure.months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(figure.covered).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("puts A's insurance back into April and May, though B has a bill there, and B's not", () => {
    // A: 60 € in each of the six months. B: 15 € in three of them, 15 € x 3 / 6 = 7,50 €
    expect(of("insurance")).toBe(6_000 + 750);
  });

  it("expects the exact month: the rent, A's groceries, B's bill and purchases as the months spent them", () => {
    expect(of("housing")).toBe(90_000);
    expect(of("groceries")).toBe(40_000);
    expect(of("card_bill")).toBe(6_750);
    expect(of("restaurants")).toBe(6_000);
    expect(expectedSpending(ctx, "2026-10")).toBe(149_500);
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
