/**
 * The comparison of a month's total never locks on a card gap. A base month that holds a card's purchases only as a
 * bill still holds the whole total (the bill counts as spending), so the expected month, its band and the end of the
 * running month are there; only the days and the categories wait for months that hold the purchases. Made-up
 * households: pay, rent and ten purchases of 520 € in all a month, which are on a card, or paid by its bill.
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
const checking: Account = { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Morrow Bank Visa", bank: "Morrow Bank", iban: null, currency: "EUR", type: "credit_card" };
/** Ten purchases a month, 520 € together, on days 3 to 21. */
const PURCHASES = [4_000, 6_400, 4_000, 6_400, 4_000, 6_400, 4_000, 6_400, 4_000, 6_400];

const row = (id: string, accountId: string, bookingDate: string, amountCents: number, counterparty: string, description: string | null = null): Transaction =>
  tx({ id, accountId, bookingDate, amountCents, counterparty, description, merchant: normalizeMerchant(counterparty, description) });

/**
 * January to the 9th of October 2026. The card's own rows begin in `cardSince` (null: no card is connected). Every month
 * before October holds the card's bill on the checking account; `paired` false leaves the card's payment row out, so
 * the bill stays unmatched with the card's purchases.
 */
function household(cardSince: string | null, paired = true) {
  const out: Transaction[] = [];
  for (let m = "2026-01", i = 0; m <= TODAY.slice(0, 7); m = addMonths(m, 1), i++) {
    const own = cardSince !== null && m >= cardSince;
    out.push(row(`rent-${i}`, "chk", dateIn(m, 2), -90_000, "ASUNTO OY ESIMERKKI", "VUOKRA"));
    out.push(row(`pay-${i}`, "chk", dateIn(m, 1), 300_000, "ESIMERKKI OY", "PALKKA"));
    if (own) {
      PURCHASES.forEach((cents, k) => {
        const date = dateIn(m, 3 + 2 * k);
        if (date <= TODAY) out.push(row(`buy-${i}-${k}`, "card", date, -cents, `KAUPPA ${String.fromCharCode(65 + k)} ESIMERKKI`));
      });
    }
    if (m < TODAY.slice(0, 7)) {
      out.push(row(`bill-${i}`, "chk", dateIn(m, 24), -52_000, "MORROW BANK ASA", "LASKU"));
      if (own && paired) out.push(row(`paid-${i}`, "card", dateIn(m, 24), 52_000, "SUORITUS", "SUORITUS"));
    }
  }
  const accounts = cardSince === null ? [checking] : [checking, card];
  return createContext(enrichTransactions(out, accounts, []), accounts, TODAY);
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
    expect(coversCategories(figure)).toBe(false);
    expect(usualGap(late, "2026-10")).toBe("cards");
    expect(pace).toMatchObject({ expected: null, cardGap: true });
  });

  it("expects the same month as a card whose feed covers every month", () => {
    const billed = expectedSpending(late, "2026-10")!;
    const itemised = expectedSpending(whole, "2026-10")!;
    expect(Math.abs(billed - itemised)).toBeLessThanOrEqual(itemised * 0.1);
  });
});

describe("a card that is not connected", () => {
  it("compares the total: its bills are the spending of every base month", () => {
    const ctx = household(null);
    const { figure, pace } = expectTotalComparison(ctx);
    expect(figure.covered).toEqual([]);
    expect(pace).toMatchObject({ expected: null, cardGap: true });
    expect(missingCards(ctx, { from: "2026-04-01", to: "2026-09-30" }).bills.map((b) => b.reason)).toEqual(["not_connected"]);
  });
});

describe("a bill that pairs with none of the connected card's rows", () => {
  it("compares the total all the same", () => {
    const ctx = household("2026-01", false);
    expect(missingCards(ctx, { from: "2026-04-01", to: "2026-09-30" }).bills.map((b) => b.reason)).toEqual(["unmatched"]);
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
