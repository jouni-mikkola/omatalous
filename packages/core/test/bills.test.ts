import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { addDays } from "../src/dates.ts";
import { buildReports } from "../src/reports/index.ts";
import { upcomingReport } from "../src/reports/upcoming.ts";
import type { Account, ExpectedBill, Transaction, UserInputs } from "../src/types.ts";
import { series } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

/** Five charges a quarter apart, the last on `last`: a quarterly bill the history has found. */
const quarterly = (merchant: string, last: string, cents: number, category = "insurance"): Transaction[] =>
  series(addDays(last, -365), 91.31, 5, -cents, { category, merchant });
/** Three charges half a year apart, the last on `last`. */
const semiannual = (merchant: string, last: string, cents: number, category = "insurance"): Transaction[] =>
  series(addDays(last, -365), 182.62, 3, -cents, { category, merchant });

const bill = (name: string, amountCents: number, dueDate: string, cadence: ExpectedBill["cadence"], category: string | null = null): ExpectedBill => ({
  id: `b-${name}-${dueDate}`,
  name,
  amountCents,
  dueDate,
  cadence,
  category,
});
const inputs = (...expectedBills: ExpectedBill[]): UserInputs => ({ marks: [], expectedBills });
const report = (rows: Transaction[], u: UserInputs = inputs(), on = today) => upcomingReport(createContext(rows, [checking], on), u);
/** `formatEur` puts a no-break space before the euro sign. */
const plain = (s: string) => s.replace(/ /g, " ");

describe("upcoming: what to set aside for rare bills", () => {
  it("the monthly reserve is the yearly cost of the rare bills over twelve", () => {
    const rows = [...quarterly("If", "2026-08-20", 15000), ...semiannual("Lähitapiola", "2026-08-20", 9600)];
    const u = report(rows, inputs(bill("Ajoneuvovero", 12000, "2027-03-01", "yearly", "taxes")));
    // four quarters, two halves, one year: 60 000 + 19 200 + 12 000
    expect(u.yearlyCents).toBe(91200);
    expect(u.reserveMonthlyCents * 12).toBe(u.yearlyCents);
    expect(u.reserveMonthlyCents).toBe(7600);
    expect(u.months.reduce((s, m) => s + m.cents, 0)).toBe(u.yearlyCents);
  });

  it("says the reserve and the year in one sentence", () => {
    const u = report(quarterly("If", "2026-08-20", 14100));
    expect(plain(u.advice)).toBe("Varaa 47 € kuussa, harvinaiset laskut ovat 564 € vuodessa.");
  });

  it("the year is twelve calendar months from this one, the dearest bill first in each", () => {
    const u = report([...quarterly("If", "2026-08-20", 9640), ...semiannual("Lähitapiola", "2026-08-20", 8900)]);
    expect(u.months.map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09"]);
    // If on 20.11., 20.2., 20.5., 20.8.; Lähitapiola on 20.2. and 20.8.
    expect(u.months.map((m) => m.cents)).toEqual([0, 9640, 0, 0, 9640 + 8900, 0, 0, 9640, 0, 0, 9640 + 8900, 0]);
    expect(u.months[4]!.names).toEqual(["If", "Lähitapiola"]);
    expect(u.months[0]!.names).toEqual([]);
  });

  it("the yearly figure does not depend on whether this month's charge has been paid", () => {
    // paid on the 3rd of this month, last month, and two months ago: the same bill, the same year
    const years = ["2026-10-03", "2026-09-03", "2026-08-20"].map((last) => report(quarterly("If", last, 12000)).yearlyCents);
    expect(years).toEqual([48000, 48000, 48000]);
    // and a bill paid this month is no longer ahead, so it is not in the next three months
    const paid = report(quarterly("If", "2026-10-03", 12000));
    expect(paid.items.map((i) => i.date)).toEqual(["2027-01-03"]);
    expect(paid.months[0]!.cents).toBe(12000);
  });

  it("a bill that is a few days late stays in the year, and only the list of what is coming drops it", () => {
    // 150 € every quarter, last paid 3.7.: due 3.10., which is late on the 6th (3 days) and overdue on the 9th (6 days)
    const rows = quarterly("If", "2026-07-03", 15000);
    const late = report(rows, inputs(), "2026-10-06");
    const overdue = report(rows, inputs(), "2026-10-09");
    // the late charge shows as today, the next one on its date
    expect(late.items.map((i) => i.date)).toEqual(["2026-10-06", "2027-01-03"]);
    expect(overdue.items).toEqual([]);
    for (const u of [late, overdue]) {
      expect(u.yearlyCents).toBe(60000);
      expect(u.reserveMonthlyCents).toBe(5000);
    }
  });

  it("a bill late from last month is listed as coming but is not a fifth charge in the year", () => {
    // due 29.9., today the 2nd: the charges of the year ahead are 29.12., 29.3., 29.6. and 29.9.
    const u = report(quarterly("If", "2026-06-29", 15000), inputs(), "2026-10-02");
    expect(u.items.map((i) => i.date)).toEqual(["2026-10-02", "2026-12-29"]);
    expect(u.yearlyCents).toBe(60000);
    expect(u.months[0]!.cents).toBe(0);
  });

  it("a bill the user typed in and one the history found are not counted twice", () => {
    const rows = quarterly("Lähitapiola", "2026-08-20", 9640);
    const alone = report(rows);
    // the name matches when case and umlauts are folded
    const both = report(rows, inputs(bill("LAHITAPIOLA", 9640, "2026-11-20", "quarterly", "insurance"), bill("Ajoneuvovero", 12000, "2027-03-01", "yearly")));
    expect(both.yearlyCents).toBe(alone.yearlyCents + 12000);
    expect(both.items.filter((i) => i.merchant === "Lähitapiola" || i.merchant === "LAHITAPIOLA")).toHaveLength(1);
    expect(both.items.find((i) => i.merchant === "Lähitapiola")!.source).toBe("detected");
    const dup = both.manual.find((b) => b.name === "LAHITAPIOLA")!;
    expect(dup.counted).toBe(false);
    expect(both.manual.find((b) => b.name === "Ajoneuvovero")!.counted).toBe(true);
    // the reserve does not carry the typed-in copy either
    expect(both.reserveMonthlyCents).toBe(Math.round((alone.yearlyCents + 12000) / 12));
  });

  it("a typed-in bill whose name matches nothing found is its own bill", () => {
    const rows = quarterly("Lähitapiola", "2026-08-20", 9640);
    const u = report(rows, inputs(bill("Lähivakuutus", 9640, "2026-11-20", "quarterly")));
    expect(u.items.map((i) => i.source).sort()).toEqual(["detected", "manual"]);
  });

  it("a one-off bill is spread over the months until it is due", () => {
    const u = report([], inputs(bill("Veronpalautus", 60000, "2026-12-15", "once", "taxes")));
    // October, November and December: 200 € a month, and all of it in December
    expect(u.reserveMonthlyCents).toBe(20000);
    expect(u.months.map((m) => m.cents)).toEqual([0, 0, 60000, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(u.yearlyCents).toBe(60000);
    // due this month: all of it now
    expect(report([], inputs(bill("Sakko", 15000, "2026-10-20", "once"))).reserveMonthlyCents).toBe(15000);
    // a one-off next to a repeating bill: the repeating one is a twelfth, the one-off a third
    const both = report([], inputs(bill("Veronpalautus", 60000, "2026-12-15", "once"), bill("Ajoneuvovero", 12000, "2027-03-01", "yearly")));
    expect(both.reserveMonthlyCents).toBe(20000 + 1000);
  });

  it("the reserve for a one-off does not change through the month it falls due in", () => {
    const sakko = inputs(bill("Sakko", 60000, "2026-10-20", "once"));
    // before, on and after the due date: the same 600 € for the month, and nothing from the 1st of the next
    expect(["2026-10-01", "2026-10-09", "2026-10-20", "2026-10-21", "2026-10-31"].map((on) => report([], sakko, on).reserveMonthlyCents)).toEqual([60000, 60000, 60000, 60000, 60000]);
    expect(report([], sakko, "2026-10-21").yearlyCents).toBe(60000);
    expect(report([], sakko, "2026-11-01").reserveMonthlyCents).toBe(0);
    // only what is still ahead is listed
    expect(report([], sakko, "2026-10-09").items.map((i) => i.date)).toEqual(["2026-10-20"]);
    expect(report([], sakko, "2026-10-21").items).toEqual([]);
  });

  it("a one-off that has passed is history, and one beyond the year is not reserved yet", () => {
    const past = report([], inputs(bill("Sakko", 15000, "2026-09-20", "once")));
    expect(past.yearlyCents).toBe(0);
    expect(past.advice).toBe("");
    expect(past.manual).toMatchObject([{ name: "Sakko", nextDate: null }]);
    const far = report([], inputs(bill("Remontti", 90000, "2027-11-01", "once")));
    expect(far.yearlyCents).toBe(0);
    expect(far.manual).toMatchObject([{ name: "Remontti", nextDate: "2027-11-01" }]);
  });

  it("a repeating bill typed in repeats by its cadence, in the next three months and in the year", () => {
    const u = report([], inputs(bill("Autovakuutus", 18000, "2026-11-01", "quarterly", "insurance")));
    expect(u.items).toEqual([{ merchant: "Autovakuutus", category: "insurance", cadence: "quarterly", date: "2026-11-01", amountCents: 18000, source: "manual" }]);
    expect(u.totalCents).toBe(18000);
    expect(u.months.map((m) => m.cents)).toEqual([0, 18000, 0, 0, 18000, 0, 0, 18000, 0, 0, 18000, 0]);
    expect(u.yearlyCents).toBe(72000);
    expect(u.reserveMonthlyCents).toBe(6000);
  });

  it("a bill typed in with a first due date from last month keeps its dates", () => {
    // due 20.9. every quarter: 20.12., 20.3., 20.6., 20.9. fall in the year
    const u = report([], inputs(bill("Autovakuutus", 18000, "2026-09-20", "quarterly")));
    expect(u.yearlyCents).toBe(72000);
    expect(u.items.map((i) => i.date)).toEqual(["2026-12-20"]);
    expect(u.manual[0]!.nextDate).toBe("2026-12-20");
  });

  it("the monthly bills stay out and a bill with no bills at all says nothing", () => {
    const monthly = series("2025-09-12", 30.44, 13, -1199, { category: "subscriptions", merchant: "Spotify" });
    const u = report(monthly);
    expect(u).toMatchObject({ items: [], totalCents: 0, yearlyCents: 0, reserveMonthlyCents: 0, advice: "", manual: [] });
    expect(u.months).toHaveLength(12);
    expect(u.months.every((m) => m.cents === 0)).toBe(true);
  });

  it("lists every typed-in bill, the soonest first, whatever the horizon", () => {
    const u = report([], inputs(bill("Vero", 31000, "2027-06-01", "yearly"), bill("Vakuutus", 9000, "2026-11-05", "quarterly"), bill("Sakko", 5000, "2026-09-20", "once")));
    expect(u.manual.map((b) => [b.name, b.nextDate])).toEqual([
      ["Vakuutus", "2026-11-05"],
      ["Vero", "2027-06-01"],
      ["Sakko", null],
    ]);
  });

  it("the report registry hands the typed-in bills to it", () => {
    const ctx = createContext(quarterly("If", "2026-08-20", 9640), [checking], today);
    const range = { from: "2026-01-01", to: "2026-09-30" };
    const without = buildReports({ ctx, range, balances: [] }).upcoming;
    const withBill = buildReports({ ctx, range, balances: [], inputs: inputs(bill("Ajoneuvovero", 12000, "2027-03-01", "yearly")) }).upcoming;
    expect(withBill.yearlyCents).toBe(without.yearlyCents + 12000);
    expect(withBill.manual).toHaveLength(1);
  });
});
