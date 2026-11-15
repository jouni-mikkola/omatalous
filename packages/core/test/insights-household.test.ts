import { describe, expect, it } from "vitest";
import type { AheadData } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { categoryPace } from "../src/analysis/insights/category-pace.ts";
import { debtFree } from "../src/analysis/insights/debt-free.ts";
import { paydayBills } from "../src/analysis/insights/payday-bills.ts";
import { rareBills } from "../src/analysis/insights/rare-bills.ts";
import { savingsRateWithoutPersons } from "../src/analysis/insights/savings-rate.ts";
import type { Insight, InsightArgs } from "../src/analysis/insights/types.ts";
import { addMonths } from "../src/dates.ts";
import { insightText } from "../src/explain/insights.ts";
import { debtPath } from "../src/loan-path.ts";
import { type Account, type Loan, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const plain = (s: string) => s.replace(/[  ]/g, " ");

/** `count` charges on `day` of each month from `start` (YYYY-MM). */
function monthly(start: string, day: number, count: number, amount: number, partial: Partial<Transaction> = {}): Transaction[] {
  return Array.from({ length: count }, (_, i) => tx({ ...partial, bookingDate: `${addMonths(start, i)}-${String(day).padStart(2, "0")}`, amountCents: amount }));
}

const argsOf = (txs: Transaction[], at: string, over: Partial<InsightArgs> = {}): InsightArgs =>
  ({ ctx: createContext(txs, [checking], at), end: at, running: true, inputs: NO_INPUTS, gateMonthlyCents: 0, ahead: null, lang: "fi", ...over }) as unknown as InsightArgs;

/** The shapes every insight keeps: two sentences, a calc line that ends in its year, an action and a comparison. */
function expectShape(i: Insight) {
  const text = insightText(i);
  expect(text.title.split(/\s+/).length, text.title).toBeLessThanOrEqual(8);
  expect(plain(text.detail), text.detail).toMatch(/\.$/);
  expect(i.evidence.calc.at(-1)).toEqual(i.effectPerYear);
  expect(i.effectPerYear).not.toBeNull();
  return text;
}

describe("bills that come rarely", () => {
  const history = [...monthly("2023-01", 15, 45, 300000, { category: "salary", merchant: "Työnantaja Oy" }), ...[2023, 2024, 2025].map((y) => tx({ bookingDate: `${y}-12-15`, amountCents: -72000, category: "insurance", merchant: "Vakuutus Oy" }))];

  it("hit: a yearly bill gives a reserve a month and names the next one", () => {
    const [found] = rareBills(argsOf(history, "2026-10-09"));
    expect(found).toMatchObject({ id: "rare-bills", comparison: { label: "reserve" }, action: { label: "seeBills" } });
    if (found?.fact.type !== "rare-bills") throw new Error("no rare-bills fact");
    expect(found.fact.next).toMatchObject({ merchant: "Vakuutus Oy", date: "2026-12-15", cents: 72000 });
    expect(found.fact.yearlyCents).toBe(72000);
    expect(found.effectPerYear!.cents).toBe(-72000);
    expect(expectShape(found).detail).toContain("Vakuutus Oy");
  });

  it("near miss: nothing is told for a period that has ended", () => {
    expect(rareBills(argsOf(history, "2026-10-09", { running: false }))).toEqual([]);
  });

  it("near miss: a yearly bill under the reserve line is told nothing", () => {
    const small = history.map((t) => (t.category === "insurance" ? { ...t, amountCents: -20160 } : t));
    expect(rareBills(argsOf(small, "2026-10-09"))).toEqual([]);
  });

  it("near miss: a household with only monthly bills has none", () => {
    expect(rareBills(argsOf(monthly("2023-01", 15, 45, 300000, { category: "salary", merchant: "Työnantaja Oy" }), "2026-10-09"))).toEqual([]);
  });
});

describe("debt-free date", () => {
  const today = "2026-10-19";
  const loan: Loan = {
    id: "loan-1",
    name: "Asuntolaina",
    lender: null,
    kind: "mortgage",
    grantedCents: null,
    balanceCents: 12_000_000,
    balanceDate: "2026-01-15",
    rateBp: 350,
    reference: "euribor_12",
    marginBp: 60,
    repayment: "annuity",
    intervalMonths: 1,
    paymentCents: 70_000,
    endDate: "2045-01-15",
    limitCents: null,
    seriesKey: null,
  };
  const salary = monthly("2025-01", 15, 22, 300000, { category: "salary", merchant: "Työnantaja Oy" });

  it("hit: the date of the last payment and the interest of the loans", () => {
    const [found] = debtFree(argsOf(salary, today, { inputs: { ...NO_INPUTS, loans: [loan] } }));
    const path = debtPath([loan], today);
    expect(found).toMatchObject({ id: "debt-free", comparison: { label: "interestYear" }, action: { label: "seeLoans" } });
    if (found?.fact.type !== "debt-free") throw new Error("no debt-free fact");
    expect(found.fact.date).toBe(path.payoff);
    expect(found.fact.interestCents).toBe(path.interestCents[0]);
    expect(found.fact.left).toBe(0);
    expect(found.effectPerYear!.cents).toBeLessThan(0);
    expectShape(found);
  });

  it("near miss: a card has no day on which it is paid off", () => {
    const card: Loan = { ...loan, kind: "card", limitCents: 500_000, repayment: null, paymentCents: null, endDate: null };
    expect(debtFree(argsOf(salary, today, { inputs: { ...NO_INPUTS, loans: [card] } }))).toEqual([]);
  });

  it("near miss: no loans, no date", () => {
    expect(debtFree(argsOf(salary, today))).toEqual([]);
  });
});

describe("savings rate without person payments", () => {
  const at = "2026-10-09";
  const base = [
    ...monthly("2025-09", 25, 14, 300000, { category: "salary", merchant: "Acme Oy" }),
    ...monthly("2025-09", 2, 14, -105000, { category: "housing", merchant: "Sato Oyj" }),
    ...monthly("2025-09", 6, 14, -90000, { category: "investments", merchant: "Nordnet" }),
  ].filter((t) => t.bookingDate <= at);

  it("hit: the rate on own income is set against the rate with the payments from people", () => {
    const people = monthly("2025-09", 12, 14, 30000, { category: "p2p_in", merchant: "Maija Meikäläinen" }).filter((t) => t.bookingDate <= at);
    const [found] = savingsRateWithoutPersons(argsOf([...base, ...people], at));
    expect(found).toMatchObject({ id: "savings-rate", comparison: { label: "savingsRateAll" }, action: { label: "seeSavingsRate" } });
    if (found?.fact.type !== "savings-rate") throw new Error("no savings-rate fact");
    expect(found.fact.percent).toBeGreaterThan(found.fact.allPercent);
    expect(found.fact.personCents).toBe(30000 * found.fact.months);
    expect(found.evidence.rows.length).toBe(found.fact.months);
    expectShape(found);
  });

  it("near miss: no payments from people, no second rate", () => {
    expect(savingsRateWithoutPersons(argsOf(base, at))).toEqual([]);
  });

  it("near miss: a few euros from people do not move the rate", () => {
    const small = monthly("2025-09", 12, 14, 500, { category: "p2p_in", merchant: "Maija Meikäläinen" }).filter((t) => t.bookingDate <= at);
    expect(savingsRateWithoutPersons(argsOf([...base, ...small], at))).toEqual([]);
  });
});

describe("a category this month against the months before", () => {
  const at = "2026-10-12";
  const shop = (month: string, cents: number) => [3, 8].map((day) => tx({ bookingDate: `${month}-${String(day).padStart(2, "0")}`, amountCents: -cents, category: "groceries", merchant: "K-Market" }));
  const earlier = (cents: number) => ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].flatMap((m) => shop(m, cents));
  const salary = monthly("2026-04", 25, 7, 300000, { category: "salary", merchant: "Työnantaja Oy" });

  it("hit: a category 80 % over its usual is told with the same days of the months before", () => {
    const found = categoryPace(argsOf([...salary, ...earlier(5000), ...shop("2026-10", 9000)], at));
    expect(found).toHaveLength(1);
    const [i] = found;
    expect(i).toMatchObject({ id: "category-pace:groceries", comparison: { label: "recentUsual" }, action: { label: "seePace" } });
    if (i?.fact.type !== "category-pace") throw new Error("no category-pace fact");
    expect(i.fact).toMatchObject({ nowCents: 18000, usualCents: 10000, percent: 80, day: 12, months: 6 });
    expect(i.comparison.value).toEqual({ unit: "cents", value: 10000 });
    // 8 000 € more by day 12 of 31 days: 80 € over the whole month, twelve times
    expect(i.effectPerYear!.cents).toBe(-Math.round((8000 * 31) / 12) * 12);
    expect(plain(expectShape(i).title)).toContain("80 %");
  });

  it("near miss: the same spending is told nothing", () => {
    expect(categoryPace(argsOf([...salary, ...earlier(5000), ...shop("2026-10", 5000)], at))).toEqual([]);
  });

  it("near miss: in the first week the few rows of a month say little", () => {
    expect(categoryPace(argsOf([...salary, ...earlier(5000), ...shop("2026-10", 9000)], "2026-10-06"))).toEqual([]);
  });

  it("near miss: a month inside the swings of the months before is no shift", () => {
    const swings = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].flatMap((m, i) => shop(m, 3000 + i * 2000));
    expect(categoryPace(argsOf([...salary, ...swings, ...shop("2026-10", 9000)], at))).toEqual([]);
  });

  it("near miss: a month level with the months before, one of which was higher, is no shift", () => {
    const mixed = [...["2026-04", "2026-05", "2026-06", "2026-07"].flatMap((m) => shop(m, 5000)), ...shop("2026-08", 9000), ...shop("2026-09", 5000), ...shop("2026-10", 7000)];
    expect(categoryPace(argsOf([...salary, ...mixed], at))).toEqual([]);
  });
});

describe("bills on the payday itself", () => {
  const ahead = (over: Record<string, unknown> = {}) =>
    ({
      reason: "payday",
      payday: { date: "2026-12-10", name: "Työnantaja Oy", pay: { usualCents: 271500 } },
      paydayCents: 78672,
      totals: { dueCents: 120000 },
      ...over,
    }) as unknown as AheadData;
  const args = (over: Partial<InsightArgs> = {}) => argsOf([], "2026-12-03", { ahead: ahead(), ...over });

  it("hit: the bills of the payday are set against the usual pay", () => {
    const [found] = paydayBills(args());
    expect(found).toMatchObject({ id: "payday-bills", comparison: { label: "payEstimate" }, action: { label: "seeBills" } });
    if (found?.fact.type !== "payday-bills") throw new Error("no payday-bills fact");
    expect(found.fact).toMatchObject({ date: "2026-12-10", billsCents: 78672, beforeCents: 120000, payCents: 271500 });
    expect(found.effectPerYear!.cents).toBe(-78672 * 12);
    expect(plain(expectShape(found).title)).toContain("786,72");
  });

  it("near miss: no bills on the payday, no pay to wait for or a period that has ended", () => {
    expect(paydayBills(args({ ahead: ahead({ paydayCents: 0 }) }))).toEqual([]);
    expect(paydayBills(args({ ahead: ahead({ reason: "none" }) }))).toEqual([]);
    expect(paydayBills(args({ ahead: ahead({ payday: { date: "2026-12-10", name: "Työnantaja Oy", pay: null } }) }))).toEqual([]);
    expect(paydayBills(args({ running: false }))).toEqual([]);
    expect(paydayBills(args({ ahead: null }))).toEqual([]);
  });
});
