import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { explainMonth } from "../src/analysis/explain.ts";
import { addMonths } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-11";

/** `count` rows on day `day` of consecutive months from `firstMonth`, the ones after `today` left out. */
function monthly(firstMonth: string, day: number, count: number, cents: number | ((i: number) => number), partial: Partial<Transaction>): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    tx({ ...partial, bookingDate: `${addMonths(firstMonth, i)}-${String(day).padStart(2, "0")}`, amountCents: typeof cents === "number" ? cents : cents(i) }),
  ).filter((t) => t.bookingDate <= today);
}

/** Seven categories with ordinary months from March to October 2026: salary, rent (a bill), groceries, and a few small ones. */
function ordinary(): Transaction[] {
  return [
    ...monthly("2026-03", 25, 8, 300000, { merchant: "Acme Oy", category: "salary" }),
    ...monthly("2026-03", 2, 8, -95000, { merchant: "Sato Oyj", category: "housing" }),
    ...monthly("2026-03", 11, 8, -1199, { merchant: "Spotify", category: "subscriptions" }),
    ...[3, 10, 17, 24].flatMap((d) => monthly("2026-03", d, 8, (i) => -(7000 + ((i + d) % 4) * 1500), { merchant: "Prisma", category: "groceries" })),
    ...monthly("2026-03", 6, 8, -4500, { merchant: "Ravintola", category: "restaurants" }),
    ...monthly("2026-03", 8, 8, (i) => -(2000 + (i % 3) * 500), { merchant: "HSL", category: "transport" }),
    ...monthly("2026-03", 14, 8, (i) => -(3000 + (i % 2) * 700), { merchant: "Apteekki", category: "health" }),
    ...monthly("2026-03", 16, 8, -2500, { merchant: "Kampaamo", category: "personal_care" }),
    ...monthly("2026-03", 18, 8, (i) => -(1500 + (i % 4) * 400), { merchant: "Kirjasto", category: "entertainment" }),
  ].filter((t) => t.bookingDate <= today);
}

const explain = (txs: Transaction[], month: string, now = today) => explainMonth(createContext(txs, [checking], now), month);

describe("explainMonth", () => {
  it("names the five biggest moves and the rest, and the rows add up to the month's total minus the usual total", () => {
    const txs = [
      ...ordinary(),
      // September: more of everything small, nothing big
      ...[
        ["restaurants", 9000],
        ["transport", 6000],
        ["health", 7000],
        ["personal_care", 5000],
        ["entertainment", 8000],
        ["kids", 4000],
        ["pets", 3000],
      ].map(([category, cents], i) => tx({ bookingDate: `2026-09-${20 + i}`, amountCents: -(cents as number), merchant: `Kauppa ${i}`, category: category as string })),
    ];
    const e = explain(txs, "2026-09")!;
    expect(e.rows.filter((r) => r.kind === "category")).toHaveLength(5);
    expect(e.rows.length).toBeLessThanOrEqual(7);
    // the changes, the spending and the usual levels each add up to the whole
    expect(e.rows.reduce((s, r) => s + r.changeCents, 0)).toBe(e.changeCents);
    expect(e.rows.reduce((s, r) => s + r.nowCents, 0)).toBe(e.nowCents);
    expect(e.rows.reduce((s, r) => s + r.usualCents, 0)).toBe(e.usualCents);
    expect(e.changeCents).toBe(e.nowCents - e.usualCents);
    // by absolute change, the smaller ones last
    const named = e.rows.filter((r) => r.kind === "category").map((r) => Math.abs(r.changeCents));
    expect(named).toEqual([...named].sort((a, b) => b - a));
    expect(e.rows.find((r) => r.kind === "smaller")).toMatchObject({ category: null, label: expect.stringMatching(/^Muut \(\d+\)$/) });
    expect(e.basis).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  });

  it("the smaller categories show their own changes, the gap between the category medians and the usual total is a row of its own", () => {
    // groceries 500 € every month and one 300 € purchase a month that moves between three categories
    const rotating = ["home", "shopping", "entertainment", "home", "shopping", "entertainment"];
    const txs = [
      ...monthly("2026-03", 2, 7, -50000, { merchant: "Prisma", category: "groceries" }),
      ...rotating.map((category, i) => tx({ bookingDate: `${addMonths("2026-03", i)}-10`, amountCents: -30000, merchant: `Kauppa ${i}`, category })),
    ];
    const e = explain(txs, "2026-09")!;
    // each rotating category is usually 0 and this month too; the month is 300 € under its usual 800 €
    expect(e.changeCents).toBe(-30000);
    const smaller = e.rows.find((r) => r.kind === "smaller")!;
    expect(smaller).toMatchObject({ label: "Muut (1)", nowCents: 50000, usualCents: 50000, changeCents: 0 });
    const between = e.rows.find((r) => r.kind === "between")!;
    expect(between).toMatchObject({ category: null, label: "Tasauserä", nowCents: 0, usualCents: 30000, changeCents: -30000 });
    expect(e.rows.reduce((s, r) => s + r.changeCents, 0)).toBe(e.changeCents);
    expect(e.rows.reduce((s, r) => s + r.usualCents, 0)).toBe(e.usualCents);
    expect(e.rows.reduce((s, r) => s + r.nowCents, 0)).toBe(e.nowCents);
  });

  it("a gap under a euro is rounding of the medians and is not a row", () => {
    // the usual level of each category is the mean of two middle months, a half cent that rounds up in every one
    const txs = ["groceries", "transport", "health"].flatMap((category, k) =>
      monthly("2026-03", 3 + k, 7, (i) => -(10001 + (i % 2)), { merchant: `Kauppa ${k}`, category }),
    );
    const e = explain(txs, "2026-09")!;
    expect(e.rows.some((r) => r.kind === "between")).toBe(false);
    expect(e.rows.reduce((s, r) => s + r.usualCents, 0)).toBe(e.usualCents);
    expect(e.rows.reduce((s, r) => s + r.changeCents, 0)).toBe(e.changeCents);
  });

  it("a sofa is a one-off", () => {
    const txs = [...ordinary(), tx({ bookingDate: "2026-09-12", amountCents: -120000, merchant: "Ikea", category: "home" })];
    const e = explain(txs, "2026-09")!;
    const home = e.rows.find((r) => r.category === "home")!;
    expect(home).toMatchObject({ nowCents: 120000, usualCents: 0, changeCents: 120000 });
    expect(home.cause).toMatchObject({ kind: "oneoff", merchant: "Ikea", date: "2026-09-12", amountCents: 120000 });
    expect(home.cause!.text).toContain("Ikea");
    // the largest row is the sofa
    expect(e.rows[0]!.category).toBe("home");
  });

  it("many small purchases are not a one-off", () => {
    const txs = [...ordinary(), ...[2, 6, 9, 13, 18, 22].map((d) => tx({ bookingDate: `2026-09-${String(d).padStart(2, "0")}`, amountCents: -9000, merchant: `Kauppa ${d}`, category: "home" }))];
    const home = explain(txs, "2026-09")!.rows.find((r) => r.category === "home")!;
    expect(home.changeCents).toBe(54000);
    expect(home.cause).toBeNull();
  });

  it("a payment that is no bigger than the category's recurring ones is not a one-off", () => {
    // Prisma takes 600 € and 400 € in turn, twice a month apart each: two series. September has 500 € and 400 € of other shops (the history starts on the 5th, so March is not complete).
    const alternating = monthly("2026-03", 5, 6, (i) => (i % 2 ? -40000 : -60000), { merchant: "Prisma", category: "groceries" });
    const txs = [
      ...alternating,
      tx({ bookingDate: "2026-09-05", amountCents: -50000, merchant: "Prisma", category: "groceries" }),
      ...[8, 14, 20, 26].map((d) => tx({ bookingDate: `2026-09-${String(d).padStart(2, "0")}`, amountCents: -10000, merchant: `Kauppa ${d}`, category: "groceries" })),
    ];
    const groceries = explain(txs, "2026-09")!.rows.find((r) => r.category === "groceries")!;
    expect(groceries.changeCents).toBe(50000);
    expect(groceries.cause).toBeNull();
  });

  it("a card bill is no purchase, so it is never a one-off", () => {
    const txs = [...ordinary(), tx({ bookingDate: "2026-09-20", amountCents: -260000, merchant: "Nordea Mastercard", category: "card_bill" })];
    const bill = explain(txs, "2026-09")!.rows.find((r) => r.category === "card_bill")!;
    expect(bill.changeCents).toBe(260000);
    expect(bill.cause).toBeNull();
  });

  it("a bill paid twice is timing, and the month without it is timing too", () => {
    // the October rent was paid on 30.9., the September one on 2.9.
    const txs = [...ordinary().filter((t) => !(t.merchant === "Sato Oyj" && t.bookingDate >= "2026-10-01")), tx({ bookingDate: "2026-09-30", amountCents: -95000, merchant: "Sato Oyj", category: "housing" })];
    const september = explain(txs, "2026-09")!;
    const housing = september.rows.find((r) => r.category === "housing")!;
    expect(housing).toMatchObject({ nowCents: 190000, usualCents: 95000, changeCents: 95000 });
    expect(housing.cause).toMatchObject({ kind: "twice", merchant: "Sato Oyj", amountCents: 95000 });
    expect(housing.cause!.text).toContain("2.9. ja 30.9.");

    // an August without its rent: paid on 31.7. and 1.9. instead
    const late = [...ordinary().filter((t) => !(t.merchant === "Sato Oyj" && t.bookingDate.startsWith("2026-08"))), tx({ bookingDate: "2026-09-01", amountCents: -95000, merchant: "Sato Oyj", category: "housing" })];
    const august = explain(late, "2026-08")!.rows.find((r) => r.category === "housing")!;
    expect(august).toMatchObject({ nowCents: 0, usualCents: 95000, changeCents: -95000 });
    expect(august.cause).toMatchObject({ kind: "missing", merchant: "Sato Oyj" });
  });

  it("the extra charge of a bill that came twice is the larger one, whichever came first", () => {
    // an electricity bill of about 41 € on the 2nd, and in September a 300 € true-up on the 1st before the ordinary bill
    const bills = monthly("2026-03", 2, 8, (i) => -(4000 + (i % 3) * 100), { merchant: "Fortum", category: "utilities" }).filter((t) => !t.bookingDate.startsWith("2026-09"));
    const txs = [...bills, tx({ bookingDate: "2026-09-01", amountCents: -30000, merchant: "Fortum", category: "utilities" }), tx({ bookingDate: "2026-09-02", amountCents: -4000, merchant: "Fortum", category: "utilities" })];
    const utilities = explain(txs, "2026-09")!.rows.find((r) => r.category === "utilities")!;
    expect(utilities.cause).toMatchObject({ kind: "twice", merchant: "Fortum", amountCents: 30000, date: "2026-09-01" });
  });

  it("a missing bill says the usual figure of the table, not the latest price", () => {
    // the rent was 950 € for four months and 1 200 € for the last two; September's has not been paid
    const rent = monthly("2026-03", 2, 8, (i) => (i < 4 ? -95000 : -120000), { merchant: "Sato Oyj", category: "housing" }).filter((t) => !t.bookingDate.startsWith("2026-09"));
    const e = explain([...ordinary().filter((t) => t.merchant !== "Sato Oyj"), ...rent], "2026-09")!;
    const housing = e.rows.find((r) => r.category === "housing")!;
    expect(housing).toMatchObject({ nowCents: 0, usualCents: 95000, changeCents: -95000 });
    expect(housing.cause).toMatchObject({ kind: "missing", merchant: "Sato Oyj", amountCents: 95000 });
    expect(housing.cause!.text.replace(/\s/g, " ")).toContain("tavallisesti 950,00 €");
  });

  it("a new recurring charge is named", () => {
    const txs = [...ordinary(), ...monthly("2026-07", 15, 3, -4900, { merchant: "Uusi Kuntosali", category: "fitness" })];
    const fitness = explain(txs, "2026-07")!.rows.find((r) => r.category === "fitness")!;
    expect(fitness.changeCents).toBe(4900);
    expect(fitness.cause).toMatchObject({ kind: "new", merchant: "Uusi Kuntosali" });
  });

  it("a running month is compared with the same days of the usual months", () => {
    // the groceries come on the 3rd and the 24th every month; on the 11th only the first has come
    const txs = ordinary();
    const e = explain(txs, "2026-10")!;
    expect(e.running).toBe(true);
    const usualToDate = (m: string) => txs.filter((t) => t.bookingDate.startsWith(m) && t.bookingDate.slice(8) <= "11" && t.amountCents < 0 && t.category !== "salary").reduce((s, t) => s - t.amountCents, 0);
    const usual = [...e.basis].map(usualToDate).sort((a, b) => a - b);
    // an even count of months: the median is the mean of the two middle ones
    expect(e.usualCents).toBe(Math.round((usual[2]! + usual[3]!) / 2));
    // the whole month would be a far bigger level than the days so far
    const wholeMonth = txs.filter((t) => t.bookingDate.startsWith("2026-09") && t.amountCents < 0).reduce((s, t) => s - t.amountCents, 0);
    expect(e.usualCents).toBeLessThan(wholeMonth * 0.9);
    // an ordinary running month reads as ordinary, not as a saving
    expect(Math.abs(e.changeCents)).toBeLessThan(e.usualCents * 0.25);
    expect(e.rows.reduce((s, r) => s + r.changeCents, 0)).toBe(e.changeCents);
  });

  it("says nothing under three complete months, and nothing for a month still to come", () => {
    const txs = ordinary().filter((t) => t.bookingDate >= "2026-07-01");
    // July, August and September are complete: October has three before it, September only two
    expect(explain(txs, "2026-10")).not.toBeNull();
    expect(explain(txs, "2026-09")).toBeNull();
    expect(explain(txs, "2026-07")).toBeNull();
    expect(explain(ordinary(), "2026-11")).toBeNull();
    // a history that starts in the middle of a month does not count that month
    const late = ordinary().filter((t) => t.bookingDate >= "2026-06-15");
    expect(explain(late, "2026-09")).toBeNull();
    expect(explain(late, "2026-10")).not.toBeNull();
  });
});

describe("the monthly trend", () => {
  const txs = ordinary();
  const d = buildDashboard(createContext(txs, [checking], today), { from: "2026-09-01", to: "2026-09-30" });
  const spent = (month: string) => txs.filter((t) => t.bookingDate.startsWith(month) && t.amountCents < 0).reduce((s, t) => s - t.amountCents, 0);
  const medianOf = (months: string[]) => {
    const sorted = months.map(spent).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return Math.round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
  };

  it("carries one explanation and one usual level per month", () => {
    expect(d.trend.explanations).toHaveLength(d.trend.months.length);
    expect(d.trend.usual).toHaveLength(d.trend.months.length);
    const at = (m: string) => d.trend.months.indexOf(m);
    expect(d.trend.explanations[at("2026-09")]).toEqual(explain(txs, "2026-09"));
    expect(d.trend.explanations[at("2026-09")]!.nowCents).toBe(d.trend.expenses[at("2026-09")]);
    // March is the first month of the history: nothing before it, and June is the first with three complete months before it
    expect(d.trend.explanations.slice(0, at("2026-06")).every((e) => e === null)).toBe(true);
    expect(d.trend.usual.slice(0, at("2026-06")).every((u) => u === null)).toBe(true);
    expect(d.trend.explanations[at("2026-06")]).not.toBeNull();
  });

  it("the usual level is the median of the complete months before the month, never the month itself", () => {
    // the trend ends in September: six months before it, and five before August
    expect(d.trend.months.at(-1)).toBe("2026-09");
    expect(d.trend.usual.at(-1)).toBe(medianOf(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]));
    expect(d.trend.usual.at(-2)).toBe(medianOf(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]));
  });

  it("names the folded categories Muut", () => {
    expect(d.trend.series.at(-1)).toMatchObject({ category: "other_rest", label: "Muut" });
  });
});

describe("insights next to the explanation", () => {
  const quarter = { from: "2026-07-01", to: "2026-09-30" };
  // two charges a month on days that move around, so they are no bill: 33 € from April to June, then `cents`
  const pets = (cents: number) =>
    Array.from({ length: 6 }, (_, i) => [3 + ((i * 7) % 11), 16 + ((i * 5) % 11)].map((day) => tx({ bookingDate: `${addMonths("2026-04", i)}-${String(day).padStart(2, "0")}`, amountCents: i < 3 ? -3300 : -cents, merchant: "Eläinkauppa", category: "pets" }))).flat();

  it("no category swing is an insight, however large: the explanation tells it", () => {
    // a household that spends 3 000 € a month more than the ordinary one
    const big = [...ordinary(), ...monthly("2026-03", 21, 8, -300000, { merchant: "Remontti Oy", category: "car" })];
    const small = buildDashboard(createContext([...big, ...pets(5000)], [checking], today), quarter);
    // 198 € to 300 €: more than 25 % and more than 30 €, also without its largest charge, but under 2 % of three months' spending
    expect(small.categories.find((c) => c.category === "pets")).toMatchObject({ cents: 30000, previousCents: 19800 });
    expect(small.totals.expenseCents * 0.02).toBeGreaterThan(10200);
    expect(small.insights.some((i) => i.id === "swing:pets")).toBe(false);
    // the same category moving by more than that is news
    const large = buildDashboard(createContext([...big, ...pets(13000)], [checking], today), quarter);
    expect(large.insights.some((i) => i.id === "swing:pets")).toBe(false);
  });

  it("neither one month nor three have swings or a largest purchase", () => {
    const txs = [...ordinary(), ...pets(7000), tx({ bookingDate: "2026-09-12", amountCents: -120000, merchant: "Ikea", category: "home" })];
    const ctx = createContext(txs, [checking], today);
    const ids = (range: { from: string; to: string }) => buildDashboard(ctx, range).insights.map((i) => i.id);
    expect(ids({ from: "2026-09-01", to: "2026-09-30" })).not.toContain("largest");
    expect(ids({ from: "2026-09-01", to: "2026-09-30" }).some((id) => id.startsWith("swing:"))).toBe(false);
    expect(ids(quarter)).not.toContain("largest");
    expect(ids(quarter)).not.toContain("swing:pets");
  });
});
