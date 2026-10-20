import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildReports, dayHeat } from "../src/reports/index.ts";
import { addDays, weekdayOf } from "../src/dates.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { randomHistory } from "./gen.ts";
import { series, tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";
const rows = [
  ...series("2026-01-02", 30.44, 10, 300000, { category: "salary", merchant: "Acme Oy" }),
  ...series("2026-01-01", 3.5, 80, (i) => -(2000 + (i % 5) * 700), { category: "groceries", merchant: "K-Market" }),
  tx({ bookingDate: "2026-06-14", amountCents: -38900, category: "travel", merchant: "Finnair" }),
  tx({ bookingDate: "2026-06-14", amountCents: -1500, category: "restaurants", merchant: "Kahvila" }),
  tx({ bookingDate: "2026-09-20", amountCents: -12900, category: "home", merchant: "Uusi Kauppa" }),
].filter((t) => t.bookingDate <= today);

describe("days report", () => {
  const ctx = createContext(rows, [checking], today);
  const range = { from: "2026-01-01", to: "2026-12-31" };
  const r = buildReports({ ctx, range, balances: [] }, ["days", "categories"]);

  it("holds every day up to today, no more than 26 weeks, starting the grid on a Monday", () => {
    expect(r.days.to).toBe(today);
    expect(r.days.days.at(-1)!.date).toBe(today);
    expect(r.days.days.length).toBe(26 * 7);
    expect(weekdayOf(r.days.from!)).toBe(0);
    expect(r.days.from! <= r.days.days[0]!.date).toBe(true);
  });

  it("with the recurring series left out adds up to the category report's spending of the same days", () => {
    expect(r.days.totalCents).toBe(r.days.days.reduce((s, d) => s + d.cents, 0));
    const same = buildReports({ ctx, range: { from: r.days.days[0]!.date, to: today }, balances: [] }, ["categories"]);
    expect(r.days.weeks.reduce((s, w) => s + w.cents, 0)).toBe(r.days.totalCents);
    expect(r.days.weeks[0]!.from).toBe(r.days.from);
    expect(r.days.totalCents + r.days.recurringCents).toBe(same.categories.totalCents);
  });

  it("leaves the rent out: its day is the landlord's", () => {
    const rent = [...rows, ...series("2026-01-03", 30.44, 10, -105000, { category: "housing", merchant: "Sato Oyj" })].filter((t) => t.bookingDate <= today);
    const withRent = buildReports({ ctx: createContext(rent, [checking], today), range, balances: [] }, ["days"]);
    expect(withRent.days.top.map((d) => d.merchant)).not.toContain("Sato Oyj");
    expect(withRent.days.recurringCents).toBeGreaterThanOrEqual(6 * 105000);
  });

  it("names the biggest day with the payee of its largest row", () => {
    expect(r.days.top[0]).toMatchObject({ date: "2026-06-14", merchant: "Finnair", merchantCents: 38900 });
    expect(r.days.top[0]!.cents).toBeGreaterThanOrEqual(38900 + 1500);
    expect(r.days.top.map((d) => d.cents)).toEqual([...r.days.top.map((d) => d.cents)].sort((a, b) => b - a));
  });

  it("is empty with no history in the range", () => {
    const none = buildReports({ ctx, range: { from: "2027-01-01", to: "2027-02-01" }, balances: [] }, ["days"]);
    expect(none.days).toMatchObject({ from: null, days: [], top: [], totalCents: 0 });
  });

  it("shades each ended day against the usual spending day: the Finnair day is the darkest, today and empty days plain", () => {
    const ended = r.days.days.filter((d) => d.date < today && d.cents > 0);
    expect(r.days.usualDayCents).toBe(Math.round(ended.reduce((s, d) => s + d.cents, 0) / ended.length));
    expect(r.days.days.find((d) => d.date === "2026-06-14")!.heat).toBe(4);
    expect(r.days.days.filter((d) => d.cents <= 0).every((d) => d.heat === 0)).toBe(true);
    expect(r.days.days.at(-1)!.heat).toBe(0);
    // most shop days sit around the usual day: the one large day does not wash them into the first step
    expect(new Set(ended.map((d) => d.heat)).size).toBeGreaterThan(2);
  });
});

describe("dayHeat", () => {
  it("is 1 under half the usual day, 2 to it, 3 to one and a half times it, 4 above", () => {
    const days = [10, 40, 50, 60, 75, 80, 0].map((e, i) => ({ date: `2026-03-0${i + 1}`, cents: e * 100 }));
    const { usualCents, heat } = dayHeat(days, "2026-03-31");
    expect(usualCents).toBe(5250);
    expect(heat).toEqual([1, 2, 2, 3, 3, 4, 0]);
  });

  it("keeps a steady run plain and gives no shade before a day has ended", () => {
    expect(dayHeat([{ date: "2026-03-01", cents: 1000 }, { date: "2026-03-02", cents: 1100 }], "2026-03-31").heat).toEqual([0, 0]);
    expect(dayHeat([{ date: "2026-03-01", cents: 1000 }], "2026-03-01")).toEqual({ usualCents: null, heat: [0] });
  });
});

describe("days report: a weekday that stands out", () => {
  const range = { from: "2026-01-01", to: "2026-12-31" };
  const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i)).filter((d) => d < today);
  /** A purchase every day of 15 to 29 €, the noise a week has. */
  const daily = days("2026-03-01", 230).map((d, i) => tx({ bookingDate: d, amountCents: -(1500 + ((i * 37) % 15) * 100), category: "groceries", merchant: "K-Market" }));
  const leadOf = (txs: Transaction[]) => buildReports({ ctx: createContext(txs, [checking], today), range, balances: [] }, ["days"]).days.weekdayLead;

  it("hit: a big shop every Saturday is told, with the weeks it rests on", () => {
    const saturdays = days("2026-03-01", 230).filter((d) => weekdayOf(d) === 5).map((d, i) => tx({ bookingDate: d, amountCents: -(4000 + ((i * 53) % 9) * 800), category: "groceries", merchant: ["Prisma", "Lidl", "K-Citymarket", "S-Market", "Tokmanni", "Motonet", "Clas Ohlson"][(i * i + 3 * i) % 7]! }));
    const lead = leadOf([...daily, ...saturdays])!;
    expect(lead.weekday).toBe(5);
    expect(lead.cents).toBeGreaterThan(1.5 * lead.restCents);
    expect(lead.weeks).toBeGreaterThanOrEqual(24);
  });

  it("near miss: an even week names no day", () => {
    expect(leadOf(days("2026-03-01", 230).map((d) => tx({ bookingDate: d, amountCents: -2000, category: "groceries", merchant: "K-Market" })))).toBeNull();
    expect(leadOf(daily)).toBeNull();
  });

  it("near miss: one dear Saturday is no habit", () => {
    expect(leadOf([...daily, tx({ bookingDate: "2026-08-15", amountCents: -90000, category: "home", merchant: "Ikea" })])).toBeNull();
  });

  it("near miss: under eight whole weeks names no day", () => {
    const saturdays = days("2026-08-20", 60).filter((d) => weekdayOf(d) === 5).map((d) => tx({ bookingDate: d, amountCents: -9000, category: "groceries", merchant: "Prisma" }));
    expect(leadOf([...daily.filter((t) => t.bookingDate >= "2026-08-20"), ...saturdays])).toBeNull();
  });

  it("stays quiet on 30 random households", () => {
    const told: string[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const { txs, accounts, rules } = randomHistory(seed, 600);
      const ctx = createContext(enrichTransactions(txs, accounts, rules), accounts, "2025-11-15");
      const lead = buildReports({ ctx, range: { from: "2025-01-01", to: "2025-11-15" }, balances: [] }, ["days"]).days.weekdayLead;
      if (lead) told.push(`${seed}: ${lead.weekday} ${lead.cents} against ${lead.restCents}`);
    }
    expect(told).toEqual([]);
  }, 30_000);
});
