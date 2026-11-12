import { describe, expect, it } from "vitest";
import { aheadBasis } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { expectedFor } from "../src/analysis/expected.ts";
import { nytAnswer } from "../src/analysis/nyt.ts";
import { completeMonthsBefore, spendingThrough } from "../src/analysis/usual.ts";
import { addDays, dateIn, monthIndex, weekdayOf } from "../src/dates.ts";
import { type Account, type BalanceInput, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

// Nyt: the sum left before the payday, the days left, the usual everyday spending of a day and the pace band.
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const TODAY = "2026-10-26";
/** The 15th of November is a Sunday: the pay comes on the Friday before. */
const PAYDAY = "2026-11-13";
const BALANCE = 719_865;
const RENT = 90_017;
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const bal = (balanceCents: number): BalanceInput => ({ id: own.id, name: own.name, type: own.type, balanceCents, ownerName: null, balanceAt: `${TODAY}T06:00:00Z` });

/** A pay on the 15th of each month, on the Friday before when it falls on a weekend. */
const pays = (): Transaction[] =>
  MONTHS.map((m) => {
    const date = dateIn(m, 15);
    const weekday = weekdayOf(date);
    return tx({ accountId: "own", bookingDate: weekday >= 5 ? addDays(date, 4 - weekday) : date, amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary" });
  });
/** Rent on the 1st of each month. */
const rents = (): Transaction[] => MONTHS.map((m) => tx({ accountId: "own", bookingDate: `${m}-01`, amountCents: -RENT, merchant: "Sato Oyj", category: "housing" }));
/** A purchase every day from March to today: each month costs a little more a day than the one before. */
const shopping = (today: IsoDate = TODAY): Transaction[] => {
  const rows: Transaction[] = [];
  for (let d: IsoDate = "2026-03-01"; d <= today; d = addDays(d, 1)) {
    const cents = 4000 + 137 * (monthIndex(d.slice(0, 7)) - monthIndex("2026-03"));
    rows.push(tx({ accountId: "own", bookingDate: d, amountCents: -cents, merchant: "Ruokakauppa", category: "groceries" }));
  }
  return rows;
};

function run(rows: Transaction[], balances: BalanceInput[] = [bal(BALANCE)], today: IsoDate = TODAY) {
  const ctx = createContext(rows.filter((t) => t.bookingDate <= today), [own], today);
  return { ctx, answer: nytAnswer(ctx, aheadBasis(ctx, balances, NO_INPUTS)) };
}

describe("Nyt", () => {
  const rows = [...pays(), ...rents(), ...shopping()];

  it("left is the balance less the bills before the payday, to the cent", () => {
    const { left } = run(rows).answer;
    if (!left.known) throw new Error(`no sum: ${left.reason}`);
    expect(left.payday).toEqual({ date: PAYDAY, name: "Esimerkki Oy" });
    // the rent of the 1st of November is the one bill before the 13th
    expect(left.balanceCents).toBe(BALANCE);
    expect(left.billsCents).toBe(RENT);
    expect(left.leftCents).toBe(BALANCE - RENT);
    expect(left.leftCents).toBe(629_848);
  });

  it("the days left run from today to the day before the payday, and the sum is spread over them", () => {
    const { left } = run(rows).answer;
    if (!left.known) throw new Error(`no sum: ${left.reason}`);
    expect(left.days).toBe(18);
    expect(left.perDayCents).toBe(Math.round(629_848 / 18));
  });

  it("the band is the expected month's to the same day", () => {
    const { ctx, answer } = run(rows);
    const months = completeMonthsBefore(ctx, "2026-10");
    expect(months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    const at = expectedFor(ctx, "2026-10")!.at(26);
    expect(answer.pace).toEqual({
      day: 26,
      spentCents: spendingThrough(ctx, "2026-10", 26),
      usual: { lowCents: at.lowCents, highCents: at.highCents, months: 6 },
    });
    // the rent and 26 days of purchases; April to September spent less a day, so the month is above its band
    expect(answer.pace.spentCents).toBe(RENT + 26 * (4000 + 137 * 7));
    expect(answer.pace.usual!.lowCents).toBeLessThan(answer.pace.usual!.highCents);
    expect(answer.pace.spentCents).toBeGreaterThan(answer.pace.usual!.highCents);
  });

  it("the sentence names the band the chart draws and holds the sum Kuukausi calls usual", () => {
    // two base months hold a one-off purchase: the expected month leaves it out, the raw months' quartiles do not
    const uneven = [...pays(), ...rents(), ...shopping()].concat(
      ["2026-05", "2026-07"].map((m, i) => tx({ accountId: "own", bookingDate: `${m}-05`, amountCents: -(150_000 + 30_000 * i), merchant: "Huonekaluliike", category: "home" })),
    );
    const { ctx } = run(uneven);
    const raw = completeMonthsBefore(ctx, "2026-10").map((m) => spendingThrough(ctx, m, 26)).sort((a, b) => a - b);
    // the old band reached up to the months with the sofa in them, far above anything the chart drew
    const dash = buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" }, [bal(BALANCE)]);
    expect(raw.at(-2)!).toBeGreaterThan(dash.pace.expected!.high[25]!);
    expect(dash.nyt!.pace.spentCents).toBe(dash.pace.currentTotal);
    const usual = dash.nyt!.pace.usual!;
    const expected = dash.pace.expected!;
    expect(usual).toEqual({ lowCents: expected.low[25], highCents: expected.high[25], months: expected.months });
    expect(usual.lowCents).toBeLessThanOrEqual(expected.toToday);
    expect(usual.highCents).toBeGreaterThanOrEqual(expected.toToday);
    expect({ lowCents: usual.lowCents, highCents: usual.highCents }).toEqual({ lowCents: dash.home.pace!.lowCents, highCents: dash.home.pace!.highCents });
  });

  it("the usual everyday spending of a day is the first page's", () => {
    const { ctx, answer } = run(rows);
    expect(answer.usualPerDayCents).toBe(aheadBasis(ctx, [bal(BALANCE)], NO_INPUTS).ahead.everydayPerDayCents);
    expect(answer.usualPerDayCents).toBeGreaterThan(0);
  });

  it("the dashboard of the running month carries it, and a month that has ended does not", () => {
    const { ctx, answer } = run(rows);
    expect(buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" }, [bal(BALANCE)]).nyt).toEqual(answer);
    expect(buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" }, [bal(BALANCE)]).nyt).toBeNull();
  });

  it("says why there is no sum, and no band under three complete months", () => {
    expect(run(rows, []).answer.left).toEqual({ known: false, reason: "no-balance" });
    const short = run([...rents(), ...shopping()].filter((t) => t.bookingDate >= "2026-08-01")).answer;
    expect(short.left).toEqual({ known: false, reason: "no-payday", found: 0 });
    expect(short.pace.usual).toBeNull();
    expect(short.usualPerDayCents).toBeNull();
  });

  it("what an account outside the balance pays before the payday is said apart, in no figure of the sum", () => {
    const other: Account = { id: "other", name: "Toinen tili", iban: "FI49 5000 9420 0287 30", currency: "EUR", type: "savings" };
    // a loan paid on the 5th (before the payday of the 13th) and an insurance on the 20th (after it), both from the other account
    const loan = MONTHS.map((m) => tx({ accountId: "other", bookingDate: `${m}-05`, amountCents: -42_182, merchant: "Lainapankki", category: "loans" }));
    const insurance = MONTHS.map((m) => tx({ accountId: "other", bookingDate: `${m}-20`, amountCents: -7_999, merchant: "Vakuutusyhtiö", category: "insurance" }));
    const ctx = createContext([...rows, ...loan, ...insurance].filter((t) => t.bookingDate <= TODAY), [own, other], TODAY);
    const left = nytAnswer(ctx, aheadBasis(ctx, [bal(BALANCE), { ...bal(BALANCE), id: other.id, name: other.name, type: other.type }], NO_INPUTS)).left;
    if (!left.known) throw new Error(`no sum: ${left.reason}`);
    expect(left.elsewhereCents).toBe(42_182);
    // the sum is the counted account's alone, as without the other account
    expect([left.balanceCents, left.billsCents, left.leftCents]).toEqual([BALANCE, RENT, BALANCE - RENT]);
    const plain = run(rows).answer.left;
    expect(plain.known && plain.elsewhereCents).toBe(0);
  });

  // the rows of an account outside the balance were found for 30 days alone, so a payday further off left some out
  it("what an account outside the balance pays is counted to a payday more than 30 days off", () => {
    // the pay of the 15th of November (a Sunday) came on Friday the 13th: today, the next is on Tuesday the 15th of December
    const today = "2026-11-13";
    const other: Account = { id: "other", name: "Toinen tili", iban: "FI49 5000 9420 0287 30", currency: "EUR", type: "savings" };
    const loan = [...MONTHS, "2026-11"].map((m) => tx({ accountId: "other", bookingDate: `${m}-14`, amountCents: -42_182, merchant: "Lainapankki", category: "loans" }));
    const november = tx({ accountId: "own", bookingDate: today, amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary" });
    const ctx = createContext([...pays(), november, ...rents(), ...shopping(today), ...loan].filter((t) => t.bookingDate <= today), [own, other], today);
    const basis = aheadBasis(ctx, [bal(BALANCE), { ...bal(BALANCE), id: other.id, name: other.name, type: other.type }], NO_INPUTS);
    const left = nytAnswer(ctx, basis).left;
    if (!left.known) throw new Error(`no sum: ${left.reason}`);
    expect(left.payday.date).toBe("2026-12-15");
    // the 14th of November and the 14th of December, 31 days from today
    expect(left.elsewhereCents).toBe(2 * 42_182);
    // Laskut's 30 days keep their length: the row of day 31 is in `outside` alone
    expect(basis.ahead.outside.map((r) => r.date)).toEqual(["2026-11-14", "2026-12-14"]);
    expect(basis.ahead.upcoming.filter((r) => r.outside).map((r) => r.date)).toEqual(["2026-11-14"]);
  });

  it("no payday says how many pays were found", () => {
    const base = [...rents(), ...shopping()];
    const one = run([...base, ...pays().slice(-1)]).answer;
    expect(one.left).toEqual({ known: false, reason: "no-payday", found: 1 });
    expect(run(base).answer.left).toEqual({ known: false, reason: "no-payday", found: 0 });
  });
});
