import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold } from "../../../tools/findings/households.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { expectedEveryday, expectedFor, expectedSpending } from "../src/analysis/expected.ts";
import { formatEur } from "../src/analysis/format.ts";
import { messageIn } from "../src/messages.ts";
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

  it("leaves on the payday the free sum less what the counted accounts pay; with no card that is days times the everyday spending a day", () => {
    const { runway } = homeOf(rows);
    const left = runway!.leftOnPayday;
    if (!left.known) throw new Error("no runway");
    expect(runway!.takenOffPerDayCents).toBeGreaterThan(0);
    expect(left.freeCents - left.everydayCents - left.billedCents).toBe(left.leftCents);
    // rounded to a whole cent a day, so the days off by half a cent each at most
    expect(Math.abs(left.freeCents - runway!.days! * runway!.takenOffPerDayCents - left.leftCents)).toBeLessThanOrEqual(runway!.days! / 2);
  });

  it("states the usual month's everyday spending over its days for the demo household, whose purchases go on a card", () => {
    const h = demoHousehold("2026-11-11");
    const ctx = contextOf(h);
    const { runway } = buildDashboard(ctx, { from: "2026-11-01", to: "2026-11-30" }, h.balances, h.inputs).home;
    // the usual November: what the base months spent outside their bill series, on the card as well
    const month = expectedEveryday(ctx, "2026-11-01", "2026-11-30");
    if (typeof month === "string") throw new Error(month);
    const perDay = Math.round(month.cents / 30);
    // tens of euros a day, not the euro a day that leaves the checking account itself
    expect(perDay).toBeGreaterThan(3000);
    expect(runway!.leftOnPayday.known).toBe(true);
    expect(runway!.takenOffPerDayCents).toBe(perDay);
    expect(runway!.everydayPerDayCents).toBe(perDay);
    const sum = formatEur(runway!.takenOffPerDayCents, false, "fi");
    expect(messageIn("fi", "home.based", { sum }).replace(/\s/g, " ")).toBe("Arkimenoihisi kuluu viime kuukausien mukaan noin 49 € päivässä");
    // the English sentence states the same sum and names no account: the sum is of every account
    expect(messageIn("en", "home.based", { sum: "X" })).toBe("At the pace of recent months, everyday spending takes about X a day");
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
  it("tells the usual month and where the last three stand against the year", () => {
    const { direction } = homeOf([...pays(), ...rents(), ...shopping("2026-03-01", 4000)]);
    expect(direction.usualCents).not.toBeNull();
    expect(direction.months).toBeGreaterThanOrEqual(3);
    expect(direction.direction).toBe("flat");
    // the months differ by a day or two of the daily purchase, which the gate of the direction ignores
    expect(Math.abs(direction.recentChangeCents!)).toBeLessThan(gateFor(direction.usualCents!));
  });

  // 1.2.0 showed the plain mean of twelve months beside the month, so a car bought in June made every month look dearer
  it("shows the usual month as Kuukausi and the buffer read it, without a one-off of the year", () => {
    const car = tx({ accountId: own.id, bookingDate: "2026-06-10", amountCents: -1_300_000, merchant: "Autoliike Oy", category: "vehicle_purchase" });
    const rows = [...pays(), ...rents(), ...shopping("2026-03-01", 4000), car];
    const ctx = createContext(rows, [own], TODAY);
    const dash = buildDashboard(ctx, RANGE, [bal(200_000)], NO_INPUTS);
    const { direction } = dash.home;
    expect(direction.usualCents).toBe(expectedSpending(ctx, "2026-10"));
    expect(direction.usualCents).toBe(dash.pace.expected!.curve.at(-1));
    // the rent and a month of the daily purchase; the car would add over 2 000 € to a mean of seven months
    expect(direction.usualCents!).toBeLessThanOrEqual(RENT + 31 * 4000);
    expect(direction.usualCents!).toBeGreaterThanOrEqual(RENT + 30 * 4000);
    // near miss: the same months without the car give the same usual month
    expect(homeOf([...pays(), ...rents(), ...shopping("2026-03-01", 4000)]).direction.usualCents).toBe(direction.usualCents);
  });

  it("shows one usual month on the demo household: the row, the buffer's divisor and Kuukausi's expected month", () => {
    const h = demoHousehold("2026-11-11");
    const ctx = contextOf(h);
    const dash = buildDashboard(ctx, { from: "2026-11-01", to: "2026-11-30" }, h.balances, h.inputs);
    const { direction } = dash.home;
    expect(direction.usualCents).not.toBeNull();
    expect(direction.usualCents).toBe(expectedSpending(ctx, "2026-11"));
    expect(direction.bufferSpendCents).toBe(direction.usualCents);
    if (dash.pace.expected) expect(dash.pace.expected.curve.at(-1)).toBe(direction.usualCents);
    expect(direction.months).toBe(expectedFor(ctx, "2026-11")!.months.length);
  });

  it("reads the direction up when the last months cost more than the year", () => {
    const rows = [...pays(), ...rents(), ...shopping("2026-03-01", 4000).map((t) => (t.bookingDate >= "2026-07-01" && t.bookingDate < "2026-10-01" ? { ...t, amountCents: -9000 } : t))];
    const { direction } = homeOf(rows);
    expect(direction.direction).toBe("up");
    expect(direction.recentChangeCents!).toBeGreaterThan(0);
  });

  it("tells too few months as no mean", () => {
    const { direction } = homeOf([...pays().slice(-2), ...shopping("2026-10-01", 4000)]);
    expect(direction.usualCents).toBeNull();
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
