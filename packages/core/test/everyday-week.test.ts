import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { everydayPerDay } from "../src/analysis/forecast.ts";
import { addDays } from "../src/dates.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };

const TODAY = "2026-10-09";
/** The last day of the last complete month before today's: the weeks are counted back from it. */
const END = "2026-09-30";
/** The first day of the week `n` weeks before the last one: week 0 is 24.-30.9. */
const weekStart = (n: number): IsoDate => addDays(END, -7 * n - 6);

/** One purchase on the first day of each of the `weeks` latest weeks, each in a shop of its own so that no series forms. */
const shopping = (weeks: number, cents: (n: number) => number = () => 28_000): Transaction[] =>
  Array.from({ length: weeks }, (_, n) => tx({ bookingDate: weekStart(n), amountCents: -cents(n), merchant: `Kauppa ${n}`, category: "groceries" }));

const usual = (rows: Transaction[], accounts?: ReadonlySet<string>, today: IsoDate = TODAY) =>
  everydayPerDay(createContext(rows.filter((t) => t.bookingDate <= today), [checking, card], today), today.slice(0, 7), accounts);

describe("the usual spending of a day is the median week by seven", () => {
  it("thirteen weeks of 280 euros give 40 euros a day, and a sofa of 1 900 euros in one of them leaves it there", () => {
    expect(usual(shopping(13))).toBe(4000);
    const sofa = tx({ bookingDate: addDays(weekStart(5), 2), amountCents: -190_000, merchant: "Huonekaluliike", category: "home" });
    expect(usual([...shopping(13), sofa])).toBe(4000);
    // the same sofa in the mean of the weeks would be 60,88 euros a day
    expect(Math.round((13 * 28_000 + 190_000) / 91)).toBe(6088);
  });

  it("seven whole weeks say nothing, eight do, and a week the history begins inside is not whole", () => {
    expect(usual(shopping(7))).toBe(0);
    expect(usual(shopping(8))).toBe(4000);
    // the first row a day into the eighth week: seven whole weeks
    const late = shopping(8).map((t) => (t.bookingDate === weekStart(7) ? { ...t, bookingDate: addDays(weekStart(7), 1) } : t));
    expect(usual(late)).toBe(0);
  });

  it("without a complete month there is no week to end on", () => {
    const rows = [1, 3, 5, 7].map((day) => tx({ bookingDate: `2026-10-0${day}`, amountCents: -28_000, merchant: `Kauppa ${day}`, category: "groceries" }));
    expect(usual(rows)).toBe(0);
  });

  it("only the thirteen latest weeks count, and they end on the last day of the last complete month", () => {
    // weeks 13 to 20 cost 700 euros each, and the running month has a purchase of 500 euros: neither is in the figure
    const older = Array.from({ length: 8 }, (_, k) => tx({ bookingDate: weekStart(13 + k), amountCents: -70_000, merchant: `Vanha kauppa ${k}`, category: "groceries" }));
    const running = tx({ bookingDate: "2026-10-02", amountCents: -50_000, merchant: "Rautakauppa", category: "home" });
    expect(usual([...older, ...shopping(13), running])).toBe(4000);
    // the last day of the month is in the last week, the day after it in none
    const weeks = shopping(13, (n) => 22_000 + 1000 * n);
    expect(usual(weeks)).toBe(28_000 / 7);
    const onLast = tx({ bookingDate: END, amountCents: -100_000, merchant: "Kodinkoneliike", category: "home" });
    // week 0 goes from the lowest to the highest: the median moves from week 6 to week 7
    expect(usual([...weeks, onLast])).toBe(29_000 / 7);
    expect(usual([...weeks, { ...onLast, bookingDate: addDays(END, 1) }])).toBe(28_000 / 7);
    // on the 1st of the next month the weeks end on the month that just ended
    expect(usual([...weeks, { ...onLast, bookingDate: "2026-10-31" }], undefined, "2026-11-01")).not.toBe(28_000 / 7);
  });

  it("rows of a bill series are in no week", () => {
    const rent = ["2026-07-05", "2026-08-05", "2026-09-05"].map((bookingDate) => tx({ bookingDate, amountCents: -90_000, merchant: "Vuokranantaja Oy", category: "housing" }));
    const rows = [...shopping(13), ...rent];
    const ctx = createContext(rows, [checking, card], TODAY);
    expect(rent.every((t) => ctx.fixedIds.has(t.id))).toBe(true);
    expect(everydayPerDay(ctx, "2026-10")).toBe(4000);
  });

  it("a refund lowers its week, and money in that is no refund is in none", () => {
    // the weeks cost 220 to 340 euros, so the median week is week 6 with 280
    const weeks = shopping(13, (n) => 22_000 + 1000 * n);
    expect(usual(weeks)).toBe(28_000 / 7);
    // 70 euros back in week 6 make it the lowest week: the median is now week 5 with 270
    const refund = tx({ bookingDate: addDays(weekStart(6), 3), amountCents: 7000, merchant: "Kauppa 6", category: "groceries" });
    expect(usual([...weeks, refund])).toBe(27_000 / 7);
    const pay = tx({ bookingDate: addDays(weekStart(6), 3), amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary" });
    expect(usual([...weeks, pay])).toBe(28_000 / 7);
  });

  it("with accounts it is what those accounts paid themselves", () => {
    const onCard = shopping(13).map((t) => ({ ...t, id: `card-${t.id}`, accountId: "card", merchant: `Kahvila ${t.merchant}`, amountCents: -7000 }));
    const rows = [...shopping(13), ...onCard];
    expect(usual(rows)).toBe(5000);
    expect(usual(rows, new Set(["acc-1"]))).toBe(4000);
    expect(usual(rows, new Set(["card"]))).toBe(1000);
  });
});
