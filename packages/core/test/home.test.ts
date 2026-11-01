import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { gateFor } from "../src/analysis/usual.ts";
import { addDays, dateIn, daysBetween, fromMonthIndex, monthIndex, weekdayOf } from "../src/dates.ts";
import { OVERVIEW_INSIGHTS } from "../src/thresholds.ts";
import { type Account, type BalanceInput, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

// What Yhteenveto says in its five blocks, as the dashboard's `home`: one household that earns 3 000 € on the 15th, pays
// 900 € rent and buys for 40 € a day, and the same with the days of October dearer.
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const TODAY = "2026-10-26";
const RANGE = { from: "2026-10-01", to: "2026-10-31" };
const PAYDAY = "2026-11-13";
const RENT = 90_000;
const bal = (balanceCents: number): BalanceInput => ({ id: own.id, name: own.name, type: own.type, balanceCents, ownerName: null, balanceAt: `${TODAY}T06:00:00Z` });

function pays(): Transaction[] {
  const rows: Transaction[] = [];
  for (let m = monthIndex("2026-03"); m <= monthIndex("2026-10"); m++) {
    const date = dateIn(fromMonthIndex(m), 15);
    const weekday = weekdayOf(date);
    rows.push(tx({ accountId: own.id, bookingDate: weekday >= 5 ? addDays(date, 4 - weekday) : date, amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary" }));
  }
  return rows;
}
const rents = (): Transaction[] => Array.from({ length: 8 }, (_, i) => tx({ accountId: own.id, bookingDate: `${fromMonthIndex(monthIndex("2026-03") + i)}-01`, amountCents: -RENT, merchant: "Sato Oyj", category: "housing" }));
/** A purchase every day from `from` to today; the days of October cost `october` instead of `usual`. */
function shopping(from: IsoDate, usual: number, october = usual): Transaction[] {
  const rows: Transaction[] = [];
  for (let d = from; d <= TODAY; d = addDays(d, 1)) rows.push(tx({ accountId: own.id, bookingDate: d, amountCents: -(d >= "2026-10-01" ? october : usual), merchant: "Ruokakauppa", category: "groceries" }));
  return rows;
}
const homeOf = (rows: Transaction[], balanceCents = 200_000) => buildDashboard(createContext(rows, [own], TODAY), RANGE, [bal(balanceCents)], NO_INPUTS).home;

describe("home.runway", () => {
  const rows = [...pays(), ...rents(), ...shopping("2026-03-01", 4000)];

  it("is the balance less the payments, spread over the days to the payday", () => {
    const { runway } = homeOf(rows);
    expect(runway!.payday).toEqual({ date: PAYDAY, name: "Esimerkki Oy" });
    const { sum } = runway!;
    expect(sum!.balanceCents).toBe(200_000);
    expect(sum!.balanceCents - sum!.paymentsCents).toBe(sum!.freeCents);
    const days = daysBetween(TODAY, PAYDAY);
    expect(runway!.days).toBe(days);
    expect(runway!.allowancePerDayCents).toBe(Math.round(sum!.freeCents / days));
    expect(runway!.everydayPerDayCents).toBeGreaterThan(0);
  });

  it("states the everyday spending a day as the figure the payday is worked out from: the free sum less days times it is what is left", () => {
    const { runway } = homeOf(rows);
    const left = runway!.leftOnPayday;
    if (!left.known) throw new Error("no runway");
    expect(runway!.takenOffPerDayCents).toBeGreaterThan(0);
    // rounded to a whole cent a day, so the days off by half a cent each at most
    expect(Math.abs(left.freeCents - runway!.days! * runway!.takenOffPerDayCents - left.leftCents)).toBeLessThanOrEqual(runway!.days! / 2);
  });

  it("says short when the payments are more than the balance, and gives no allowance", () => {
    const { runway } = homeOf(rows, 10_000);
    expect(runway!.sum!.freeCents).toBeLessThan(0);
    expect(runway!.verdict).toBe("short");
    expect(runway!.allowancePerDayCents).toBeNull();
  });

  it("says enough when the lower end of the payday's range stays above zero", () => {
    const { runway } = homeOf(rows, 900_000);
    expect(runway!.verdict).toBe("enough");
  });

  it("does not say enough when the payday or the everyday spending is not known: the payments are covered and that is all", () => {
    const { runway } = homeOf([...rents(), ...shopping("2026-03-01", 4000)], 900_000);
    expect(runway!.leftOnPayday.known).toBe(false);
    expect(runway!.sum!.freeCents).toBeGreaterThan(0);
    expect(runway!.verdict).toBe("covered");
  });

  it("is not told for a range that does not include today", () => {
    const home = buildDashboard(createContext(rows, [own], TODAY), { from: "2026-09-01", to: "2026-09-30" }, [bal(200_000)], NO_INPUTS).home;
    expect(home.runway).toBeNull();
  });
});

describe("home.pace", () => {
  const steady = [...pays(), ...rents(), ...shopping("2026-03-01", 4000)];
  const dear = [...pays(), ...rents(), ...shopping("2026-03-01", 4000, 6000)];

  it("sets the month so far against the expected month and says where it stands", () => {
    const { pace } = homeOf(dear);
    expect(pace!.month).toBe("2026-10");
    expect(pace!.day).toBe(26);
    expect(pace!.diffCents).toBe(pace!.spentCents - pace!.expectedCents);
    expect(pace!.position).toBe("above");
    expect(pace!.lowCents).toBeLessThanOrEqual(pace!.highCents);
  });

  it("is quiet when the month goes as expected", () => {
    const { pace } = homeOf(steady);
    expect(pace!.position).toBe("within");
  });

  it("says why there is no expected month when the history is too short", () => {
    const home = homeOf([...pays().slice(-2), ...shopping("2026-10-01", 4000)]);
    expect(home.pace).toBeNull();
    expect(home.paceGap).toBe("history");
  });
});

describe("home.direction, home.notable and home.reliability", () => {
  it("tells the mean of whole months and where the last three stand against it", () => {
    const { direction } = homeOf([...pays(), ...rents(), ...shopping("2026-03-01", 4000)]);
    expect(direction.averageCents).not.toBeNull();
    expect(direction.months).toBeGreaterThanOrEqual(3);
    expect(direction.direction).toBe("flat");
    // the months differ by a day or two of the daily purchase, which the gate of the direction ignores
    expect(Math.abs(direction.recentChangeCents!)).toBeLessThan(gateFor(direction.averageCents!));
  });

  it("reads the direction up when the last months cost more than the year", () => {
    const rows = [...pays(), ...rents(), ...shopping("2026-03-01", 4000).map((t) => (t.bookingDate >= "2026-07-01" && t.bookingDate < "2026-10-01" ? { ...t, amountCents: -9000 } : t))];
    const { direction } = homeOf(rows);
    expect(direction.direction).toBe("up");
    expect(direction.recentChangeCents!).toBeGreaterThan(0);
  });

  it("tells too few months as no mean", () => {
    const { direction } = homeOf([...pays().slice(-2), ...shopping("2026-10-01", 4000)]);
    expect(direction.averageCents).toBeNull();
    expect(direction.direction).toBeNull();
  });

  it("holds at most three findings, each with what it is worth a year", () => {
    const { notable } = homeOf([...pays(), ...rents(), ...shopping("2026-03-01", 4000, 6000)]);
    expect(notable.length).toBeLessThanOrEqual(OVERVIEW_INSIGHTS);
    for (const i of notable) expect(i.effectPerYear?.cents ?? 0).not.toBe(0);
  });

  it("has no missing card purchases in a household with no card", () => {
    expect(homeOf([...pays(), ...rents(), ...shopping("2026-03-01", 4000)]).reliability.cardGap).toBeNull();
  });
});
