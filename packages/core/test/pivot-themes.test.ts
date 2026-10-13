/**
 * The months table by theme (reports/pivot.ts): the rows are placed as the themes report places them, a row has a
 * place when it holds 2 % of the spending, and the rows with the rest and the large purchases add up to the month
 * totals to the cent. Each row has the newest complete month, its usual level and the difference when it is worth
 * telling, and each line has its five largest payees and the rest.
 */
import { describe, expect, it } from "vitest";
import { applyUse } from "../src/account-use.ts";
import { createContext } from "../src/analysis/context.ts";
import { themesReport } from "../src/analysis/themes-report.ts";
import { addMonths, dateIn, monthEnd } from "../src/dates.ts";
import { type PivotReport, pivotReport } from "../src/reports/pivot.ts";
import type { Account, Part, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { EVENTS, kitHousehold } from "./kit/index.ts";
import { enrich } from "./optimise/household.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
/** The 10th of November: October 2026 is the last complete month and November is running. */
const TODAY = "2026-11-10";
const HALF: Part = { from: 0, to: 1, of: 2 };

const cents = (euros: number) => Math.round(euros * 100);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const paid = (bookingDate: string, euros: number, merchant: string, category: string) =>
  tx({ bookingDate, amountCents: -cents(euros), merchant, category, categorySource: "rule" });
const got = (bookingDate: string, euros: number, merchant: string, category: string) =>
  tx({ bookingDate, amountCents: cents(euros), merchant, category, categorySource: "rule" });
/** One payment on `day` of each month from `first` to `last`, `euros` each, the amounts of `euros` in turn. */
const monthly = (first: string, last: string, euros: number | readonly number[], merchant: string, category: string, day = 5): Transaction[] => {
  const out: Transaction[] = [];
  for (let m = first, i = 0; m <= last; m = addMonths(m, 1), i++) out.push(paid(dateIn(m, day), typeof euros === "number" ? euros : euros[i % euros.length]!, merchant, category));
  return out;
};
/** Rent from `first` to October, so the history covers every month from its start. */
const rent = (first: string) => monthly(first, "2026-11", 450, "Asunto Oy Esimerkki", "housing", 2);
const pivot = (rows: readonly Transaction[], from: string, to = "2026-10") => pivotReport(createContext([...rows], [checking], TODAY), { from: `${from}-01`, to: monthEnd(to) });
const theme = (r: PivotReport, id: string) => [...r.themes, ...(r.rest?.themes ?? [])].find((t) => t.id === id);
/** Everything the table prints as a row, by month. */
const allRows = (r: PivotReport) => [...r.themes, ...(r.rest ? [r.rest] : []), ...(r.large ? [r.large] : [])];

describe("the rows add up", () => {
  const households = [kitHousehold(null), ...EVENTS.map((e) => kitHousehold(e))];

  it.each(households.map((h) => h.name))("%s: themes, the rest and the large purchases are the month totals, to the cent, in both views", (name) => {
    const h = households.find((x) => x.name === name)!;
    const rows = enrich(h.txs, h.accounts, h.rules);
    const halves = new Map(h.accounts.map((a) => [a.id, HALF]));
    for (const ctx of [createContext(rows, h.accounts, h.today), createContext(applyUse(rows, h.accounts, halves), h.accounts, h.today)]) {
      const r = pivotReport(ctx, { from: "2025-01-01", to: h.today });
      const parts = allRows(r);
      expect(sum(parts.map((p) => p.totalCents)), name).toBe(r.totalCents);
      r.months.forEach((_, i) => expect(sum(parts.map((p) => p.values[i]!)), `${name} ${r.months[i]}`).toBe(r.monthTotals[i]));
      for (const t of [...r.themes, ...(r.rest?.themes ?? [])]) {
        expect(sum(t.lines.map((l) => l.totalCents)), t.label).toBe(t.totalCents);
        expect(sum(t.lines.flatMap((l) => l.values)), t.label).toBe(sum(t.values));
      }
      if (r.rest) expect(sum(r.rest.themes.map((t) => t.totalCents))).toBe(r.rest.totalCents);
    }
  });

  it("over the themes window each theme's sum, and each line's, is the themes report's own", () => {
    const h = kitHousehold(null);
    const ctx = createContext(enrich(h.txs, h.accounts, h.rules), h.accounts, h.today);
    const report = themesReport(ctx)!;
    const r = pivotReport(ctx, { from: `${report.window.first}-01`, to: monthEnd(report.window.last) });
    expect(report.window.months).toBe(12);
    for (const t of report.themes) {
      const own = theme(r, t.id)!;
      expect(own.totalCents, t.heading).toBe(t.yearCents);
      for (const l of t.lines) expect(own.lines.find((x) => x.id === l.id)!.totalCents, `${t.heading} / ${l.heading}`).toBe(l.yearCents);
    }
    expect(r.large?.totalCents ?? 0).toBe(report.large.cents);
  });
});

describe("which themes have a row", () => {
  /** Housing and pets between them 10 000 € a month for three months, pets `euros` of it each month. */
  const split = (euros: number) => [...monthly("2026-08", "2026-10", 10_000 - euros, "Asunto Oy Esimerkki", "housing", 2), ...monthly("2026-08", "2026-10", euros, "Esimerkkieläin Oy", "pets", 3)];

  it("a theme at 1,9 % is under Loput yhteensä and at 2,0 % has a row", () => {
    const small = pivot(split(190), "2026-08");
    expect(small.totalCents).toBe(3_000_000);
    expect(small.themes.map((t) => t.id)).toEqual(["housing"]);
    expect(small.rest!.themes.map((t) => t.id)).toEqual(["pets"]);
    const exact = pivot(split(200), "2026-08");
    expect(exact.themes.map((t) => t.id)).toEqual(["housing", "pets"]);
    expect(exact.rest).toBeNull();
  });

  it("nine themes over 2 %: eight rows, and the ninth under Loput yhteensä", () => {
    const categories = ["groceries", "health", "pets", "kids", "education", "insurance", "taxes", "shopping"];
    const rows = [...monthly("2026-08", "2026-10", 1000, "Asunto Oy Esimerkki", "housing", 2), ...categories.flatMap((c, i) => monthly("2026-08", "2026-10", 300 - i * 10, `Esimerkki ${c}`, c, 3))];
    const r = pivot(rows, "2026-08");
    expect(r.themes).toHaveLength(8);
    expect(r.themes.map((t) => t.id)).toEqual(["housing", "food", "health", "pets", "kids", "education", "insurance", "taxes"]);
    expect(r.rest!.themes.map((t) => t.id)).toEqual(["shopping"]);
    expect(r.rest!.totalCents).toBe(69_000);
  });

  it("a theme with a sum under zero is under Loput yhteensä, with its minus", () => {
    // the purchase is before the range and its money back inside it
    const r = pivot([...rent("2026-07"), paid("2026-07-20", 50, "Esimerkkieläin Oy", "pets"), got("2026-09-10", 50, "Esimerkkieläin Oy", "pets")], "2026-08");
    expect(r.themes.map((t) => t.id)).toEqual(["housing"]);
    expect(r.rest!.themes.map((t) => [t.id, t.totalCents])).toEqual([["pets", -5000]]);
    expect(sum(allRows(r).map((p) => p.totalCents))).toBe(r.totalCents);
  });

  it("the large purchases are the last row, and in no theme", () => {
    const r = pivot([...rent("2026-08"), paid("2026-09-12", 9000, "Esimerkkiauto Oy", "vehicle_purchase")], "2026-08");
    expect(r.large).toMatchObject({ totalCents: 900_000, count: 1 });
    expect(theme(r, "car") ?? theme(r, "transport")).toBeUndefined();
    expect(r.large!.values).toEqual([0, 900_000, 0]);
    expect(sum(allRows(r).map((p) => p.totalCents))).toBe(r.totalCents);
  });
});

describe("the payees of a line", () => {
  it("are the five largest by spend and the rest as Muut: together the line in every month, a refund included", () => {
    const shops = ["Kauppa A", "Kauppa B", "Kauppa C", "Kauppa D", "Kauppa E", "Kauppa F", "Kauppa G"];
    const rows = [
      ...rent("2026-08"),
      ...shops.flatMap((s, i) => [paid("2026-08-10", 100 + i * 10, s, "groceries"), paid("2026-09-10", 200 - i * 5, s, "groceries")]),
      // money back from the smallest shop of September
      got("2026-09-20", 60, "Kauppa A", "groceries"),
    ];
    const r = pivot(rows, "2026-08");
    const groceries = theme(r, "food")!.lines.find((l) => l.id === "groceries")!;
    expect(groceries.payees.map((p) => p.name)).toEqual(["Kauppa G", "Kauppa F", "Kauppa E", "Kauppa D", "Kauppa C"]);
    expect(groceries.other?.name).toBe("Muut");
    r.months.forEach((_, i) => expect(sum(groceries.payees.map((p) => p.values[i]!)) + groceries.other!.values[i]!, r.months[i]).toBe(groceries.values[i]));
    expect(sum(groceries.payees.map((p) => p.totalCents)) + groceries.other!.totalCents).toBe(groceries.totalCents);
    // the refund lowers the payee it came from, in its month
    // Kauppa A and B are the Muut: 100 + 110 € in August, and in September 200 € less 60 € back, and 195 €
    expect(groceries.other!.values).toEqual([21_000, 33_500, 0]);
    expect(groceries.values[1]).toBe(sum(shops.map((_, i) => 20_000 - i * 500)) - 6_000);
  });

  it("a line with five payees or fewer has no Muut", () => {
    const r = pivot([...rent("2026-08"), paid("2026-09-10", 90, "Kauppa A", "groceries")], "2026-08");
    expect(theme(r, "food")!.lines[0]!.other).toBeNull();
    expect(theme(r, "food")!.lines[0]!.payees.map((p) => p.name)).toEqual(["Kauppa A"]);
  });
});

describe("Tavallisesti and Ero", () => {
  /** Groceries April to September at `before` each in turn, October at `october`; rent steady. The gate is 2 % of about 850 €: 17 €. */
  const groceries = (october: number, before: readonly number[] = [400, 420, 380, 410, 390, 400]) => [
    ...rent("2026-04"),
    ...monthly("2026-04", "2026-09", before, "Kauppa A", "groceries"),
    paid("2026-10-05", october, "Kauppa A", "groceries"),
  ];
  const food = (r: PivotReport) => theme(r, "food")!;

  it("is empty inside the lowest-to-highest of the months before, and printed outside it", () => {
    const inside = pivot(groceries(405), "2026-10", "2026-10");
    expect(food(inside).usualCents).toBe(40_000);
    expect(food(inside).diffCents).toBeNull();
    const above = pivot(groceries(520), "2026-10", "2026-10");
    expect(food(above).diffCents).toBe(12_000);
    const below = pivot(groceries(300), "2026-10", "2026-10");
    expect(food(below).diffCents).toBe(-10_000);
  });

  it("is empty outside the range of the months before when it is under the household gate, and printed at the gate", () => {
    const steady = [400, 400, 400, 400, 400, 400];
    // 405 is outside 400 to 400 but 5 € is under 17 €
    expect(food(pivot(groceries(405, steady), "2026-10", "2026-10")).diffCents).toBeNull();
    expect(food(pivot(groceries(417, steady), "2026-10", "2026-10")).diffCents).toBe(1_700);
    expect(food(pivot(groceries(416.99, steady), "2026-10", "2026-10")).diffCents).toBeNull();
  });

  it("tells the usual level of the months before the range too", () => {
    // the range is October alone and the six months before it are outside it
    const r = pivot(groceries(405), "2026-10", "2026-10");
    expect(r.months).toEqual(["2026-10"]);
    expect(food(r).lines[0]!.usualCents).toBe(40_000);
  });

  it("with two complete months before is a dash, and no difference", () => {
    const r = pivot([...rent("2026-08"), ...monthly("2026-08", "2026-10", 300, "Kauppa A", "groceries")], "2026-08");
    expect(r.last).toBe(2);
    expect(food(r).usualCents).toBeNull();
    expect(food(r).diffCents).toBeNull();
    expect(food(r).lines[0]!.usualCents).toBeNull();
  });

  it("a running month is in no usual level, no mean and no strip", () => {
    const rows = [...groceries(405), paid("2026-11-04", 5000, "Kauppa A", "groceries")];
    const r = pivot(rows, "2026-04", "2026-11");
    expect(r.months.at(-1)).toBe("2026-11");
    expect(r.complete.at(-1)).toBe(false);
    expect(r.last).toBe(r.months.length - 2);
    expect(r.strip).not.toContain(r.months.length - 1);
    expect(r.peak).not.toBe(r.months.length - 1);
    expect(food(r).usualCents).toBe(40_000);
    expect(r.averageCents).toBe(Math.round(sum(r.monthTotals.slice(0, -1)) / (r.months.length - 1)));
  });

  it("with no complete month has the sums alone", () => {
    const r = pivot(rent("2026-11"), "2026-11", "2026-11");
    expect(r.complete).toEqual([false]);
    expect([r.last, r.peak, r.strip, r.peakRows]).toEqual([null, null, [], []]);
    expect(r.themes.map((t) => [t.id, t.totalCents, t.usualCents, t.diffCents])).toEqual([["housing", 45_000, null, null]]);
  });
});

describe("the strip and the highest month", () => {
  it("holds the newest twelve complete months, and the highest is marked, the newest on a tie", () => {
    const rows = [...rent("2025-06"), paid("2025-09-15", 100, "Kauppa A", "groceries"), paid("2026-03-15", 100, "Kauppa A", "groceries"), paid("2026-06-15", 100, "Kauppa A", "groceries")];
    const r = pivot(rows, "2025-06");
    expect(r.strip).toHaveLength(12);
    expect(r.strip.at(-1)).toBe(r.months.length - 1);
    // three months of 550 € tie for the highest: the newest of them
    expect(r.months[r.peak!]).toBe("2026-06");
  });

  it("is not drawn under four complete months", () => {
    const three = pivot(rent("2026-08"), "2026-08");
    expect(three.strip).toEqual([]);
    expect(three.peak).toBeNull();
    expect(pivot(rent("2026-07"), "2026-07").strip).toHaveLength(4);
  });

  it("names the three largest rows of the highest month, the large purchases among them", () => {
    const rows = [
      ...rent("2026-06"),
      paid("2026-09-06", 300, "Kauppa A", "groceries"),
      paid("2026-09-07", 200, "Ravintola Esimerkki", "restaurants"),
      paid("2026-09-08", 50, "Esimerkkieläin Oy", "pets"),
      paid("2026-09-09", 4000, "Esimerkkiauto Oy", "vehicle_purchase"),
    ];
    const r = pivot(rows, "2026-06");
    expect(r.months[r.peak!]).toBe("2026-09");
    expect(r.peakRows.map((p) => [p.label, p.cents, p.category])).toEqual([
      ["Suuret hankinnat", 400_000, null],
      ["Vuokra ja vastike", 45_000, "housing"],
      ["Ruokakauppa", 30_000, "groceries"],
    ]);
  });
});
