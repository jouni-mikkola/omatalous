/**
 * The coming list of Tulossa: the series' charges, the typed-in bills and the income in one list, grouped by payday
 * period. Imported from the package index, as the web app does.
 */
import { describe, expect, it } from "vitest";
import { type Account, type ComingPeriod, comingList, createContext, dateIn, type ExpectedBill, fromMonthIndex, type IsoDate, monthIndex, NO_INPUTS, type Transaction, type UserInputs } from "../src/index.ts";
import { tx } from "./helpers.ts";

const today = "2026-11-11";

/** One row on `day` of each month from `first` to `last` (month keys). */
function monthly(first: string, last: string, day: number, cents: number | ((i: number) => number), merchant: string, category: string): Transaction[] {
  const rows: Transaction[] = [];
  for (let m = monthIndex(first), i = 0; m <= monthIndex(last); m++, i++) {
    rows.push(tx({ bookingDate: dateIn(fromMonthIndex(m), day), amountCents: typeof cents === "function" ? cents(i) : cents, merchant, category }));
  }
  return rows;
}

const history = [
  ...monthly("2026-03", "2026-10", 23, 390_000, "Esimerkki Oy", "salary"),
  ...monthly("2026-03", "2026-11", 5, 9_463, "Kela", "benefits"),
  ...monthly("2026-03", "2026-10", 12, -89_000, "Esimerkki Asunnot", "housing"),
  // the price went up in October: the bill comes at its last amount
  ...monthly("2026-03", "2026-10", 16, (i) => (i < 7 ? -6_120 : -6_420), "Esimerkki Energia", "utilities"),
  ...monthly("2026-03", "2026-11", 2, -1_399, "Esimerkki Suoratoisto", "subscriptions"),
];
const bill = (name: string, amountCents: number, dueDate: string, cadence: ExpectedBill["cadence"] = "once"): ExpectedBill => ({ id: name, name, amountCents, dueDate, cadence, category: "insurance" });
const inputs: UserInputs = { ...NO_INPUTS, expectedBills: [bill("Kotivakuutus", 21_050, "2026-11-20"), bill("Jätehuolto", 4_800, "2026-09-01", "quarterly"), bill("Autovero", 30_000, "2027-02-01")] };

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const ctxOf = (rows: Transaction[], day: IsoDate = today) => createContext(rows.filter((t) => t.bookingDate <= day), [checking], day);
const ctx = ctxOf(history);
const view = (p: ComingPeriod) => p.rows.map((r) => `${r.date} ${r.name} ${r.cents} ${r.source}`);

describe("comingList", () => {
  const periods = comingList(ctx, inputs);

  it("groups the charges, the typed-in bills and the income by payday period", () => {
    expect(periods.map((p) => [p.from, p.to, p.payday])).toEqual([
      ["2026-11-11", "2026-11-23", "2026-11-23"],
      ["2026-11-24", "2026-12-23", "2026-12-23"],
    ]);
    expect(view(periods[0]!)).toEqual([
      "2026-11-12 Esimerkki Asunnot -89000 recurring",
      "2026-11-16 Esimerkki Energia -6420 recurring",
      "2026-11-20 Kotivakuutus -21050 expected",
      "2026-11-23 Esimerkki Oy 390000 income",
    ]);
    // the child benefit is income of its period and ends none, and the 5th is a Saturday so it comes on the Friday; the bill of February is past the payday after next
    expect(view(periods[1]!)).toEqual([
      "2026-12-01 Jätehuolto -4800 expected",
      "2026-12-02 Esimerkki Suoratoisto -1399 recurring",
      "2026-12-04 Kela 9463 income",
      "2026-12-12 Esimerkki Asunnot -89000 recurring",
      "2026-12-16 Esimerkki Energia -6420 recurring",
      "2026-12-23 Esimerkki Oy 390000 income",
    ]);
  });

  it("sums each period from its own rows", () => {
    for (const p of periods) {
      expect(p.billsCents).toBe(p.rows.filter((r) => r.cents < 0).reduce((sum, r) => sum - r.cents, 0));
      expect(p.incomeCents).toBe(p.rows.filter((r) => r.cents > 0).reduce((sum, r) => sum + r.cents, 0));
    }
    expect(periods.map((p) => [p.billsCents, p.incomeCents])).toEqual([
      [89_000 + 6_420 + 21_050, 390_000],
      [4_800 + 1_399 + 89_000 + 6_420, 390_000 + 9_463],
    ]);
  });

  it("gives a series' bill its last amount to compare against", () => {
    const energy = periods[0]!.rows.find((r) => r.name === "Esimerkki Energia")!;
    expect(energy.lastCents).toBe(6_420);
    expect(periods[0]!.rows.find((r) => r.source === "expected")!.lastCents).toBeNull();
  });

  it("leaves out a series the household marked as cancelled", () => {
    const marked = { ...inputs, marks: [{ subject: "merchant:Esimerkki Suoratoisto", mark: "cancelled" as const, markedAt: "2026-11-05T10:00:00+02:00" }] };
    const names = comingList(ctx, marked).flatMap((p) => p.rows.map((r) => r.name));
    expect(names).not.toContain("Esimerkki Suoratoisto");
    expect(names).toContain("Esimerkki Asunnot");
  });

  it("is one period of 30 days without a pay to wait for", () => {
    const [only, ...rest] = comingList(ctxOf(history.filter((t) => t.amountCents < 0)), inputs);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ from: today, to: "2026-12-11", payday: null });
    expect(only!.rows.every((r) => r.cents < 0 && r.date >= today && r.date <= "2026-12-11")).toBe(true);
    expect(only!.billsCents).toBe(only!.rows.reduce((sum, r) => sum - r.cents, 0));
  });

  it("ends no period on a pay whose day has gone by", () => {
    const late = comingList(ctxOf(history, "2026-11-25"), inputs);
// the pay of the 23rd has not come and is not late yet: no row of today, and the first period runs to the next one
    expect(late.map((p) => [p.from, p.to, p.payday])).toEqual([
      ["2026-11-25", "2026-12-23", "2026-12-23"],
      ["2026-12-24", "2027-01-22", "2027-01-22"],
    ]);
    expect(view(late[0]!).filter((r) => r.includes("Esimerkki Oy"))).toEqual(["2026-12-23 Esimerkki Oy 390000 income"]);
  });

  it("lists a monthly saving and leaves out a typed-in bill that was paid", () => {
    const rows = [
      ...history,
      ...monthly("2026-03", "2026-10", 25, -20_000, "Esimerkki Rahasto", "savings"),
      tx({ bookingDate: "2026-11-10", amountCents: -21_050, merchant: "Kotivakuutus", category: "insurance" }),
    ];
    const names = comingList(ctxOf(rows), inputs).flatMap((p) => view(p));
    expect(names).toContain("2026-11-25 Esimerkki Rahasto -20000 recurring");
    expect(names.filter((r) => r.includes("Kotivakuutus"))).toEqual([]);
  });
});
