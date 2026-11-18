import { describe, expect, it } from "vitest";
import { aheadBasis } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { nytAnswer } from "../src/analysis/nyt.ts";
import { addDays, dateIn, monthOf, weekdayOf } from "../src/dates.ts";
import { billCalendar } from "../src/reports/bill-calendar.ts";
import { upcomingReport } from "../src/reports/upcoming.ts";
import { type Account, type BalanceInput, type ExpectedBill, type IsoDate, type Loan, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

// The bill calendar: the twelve months from the one of today, a row for each bill, loan payment and pay. Made-up payees and sums only.
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const TODAY = "2026-10-26";
/** The 15th of November is a Sunday: the pay comes on the Friday before. */
const PAYDAY = "2026-11-13";
const RENT = 90_017;
const MUSIC = 1_299;
const INSURANCE = 15_000;
const PAY = 300_000;
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const FIRST_MONTHS = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09"];

/** A pay on the 15th of each month, on the Friday before when it falls on a weekend. */
const pays = (): Transaction[] =>
  MONTHS.map((m) => {
    const date = dateIn(m, 15);
    const weekday = weekdayOf(date);
    return tx({ accountId: "own", bookingDate: weekday >= 5 ? addDays(date, 4 - weekday) : date, amountCents: PAY, merchant: "Esimerkki Oy", category: "salary" });
  });
const rents = (): Transaction[] => MONTHS.map((m) => tx({ accountId: "own", bookingDate: `${m}-01`, amountCents: -RENT, merchant: "Sato Oyj", category: "housing" }));
const music = (): Transaction[] => MONTHS.map((m) => tx({ accountId: "own", bookingDate: `${m}-05`, amountCents: -MUSIC, merchant: "Esimerkki Musiikki", category: "entertainment" }));
/** A quarterly bill of one price, the last charge on 20.8.: it falls due in November, February, May and August. */
const insurance = (): Transaction[] => series("2025-08-20", 91.31, 5, -INSURANCE, { accountId: "own", category: "insurance", merchant: "Esimerkki Vakuutus" });

/**
 * A year of electricity on the 10th, each month at a size no other month has (12 % apart, so no two charges are one price
 * and none is a product of its own): the winter months cost the most.
 */
const RANK: Record<string, number> = {
  "2025-11": 9, "2025-12": 11, "2026-01": 10, "2026-02": 8, "2026-03": 7, "2026-04": 3, "2026-05": 1, "2026-06": 0, "2026-07": 2, "2026-08": 4, "2026-09": 5, "2026-10": 6,
};
const power = (month: string): number => Math.round(6000 * 1.12 ** RANK[month]!);
const electricity = (): Transaction[] =>
  Object.keys(RANK).map((m) => tx({ accountId: "own", bookingDate: `${m}-10`, amountCents: -power(m), merchant: "Esimerkki Energia", category: "utilities" }));

const household = (): Transaction[] => [...pays(), ...rents(), ...music(), ...insurance(), ...electricity()];

function run(rows: Transaction[], inputs: UserInputs = NO_INPUTS, today: IsoDate = TODAY) {
  const ctx = createContext(rows.filter((t) => t.bookingDate <= today), [own], today);
  return { ctx, cal: billCalendar(ctx, inputs) };
}
const rowsOf = (cal: ReturnType<typeof run>["cal"]) => cal.months.flatMap((m) => m.rows);
const typical = (ctx: ReturnType<typeof run>["ctx"], merchant: string) => ctx.recurring.find((s) => s.merchant === merchant)!.typicalAmountCents;
const typedBill = (name: string, amountCents: number, dueDate: string, cadence: ExpectedBill["cadence"] = "once"): ExpectedBill => ({ id: `b-${name}`, name, amountCents, dueDate, cadence, category: null });
const withBills = (...expectedBills: ExpectedBill[]): UserInputs => ({ marks: [], expectedBills });

describe("the bill calendar", () => {
  it("holds the twelve calendar months from the one of today, to the last day of the twelfth", () => {
    const { cal } = run(household());
    expect(cal.months.map((m) => m.month)).toEqual(FIRST_MONTHS);
    expect(cal).toMatchObject({ from: TODAY, to: "2027-09-30" });
    expect(rowsOf(cal).every((r) => r.date >= TODAY.slice(0, 7) + "-01" && r.date <= "2027-09-30")).toBe(true);
  });

  it("adds each month up to its rows, to the cent, the paid ones left out", () => {
    const { ctx, cal } = run(household());
    for (const m of cal.months) {
      const sum = (keep: (r: (typeof m.rows)[number]) => boolean) => m.rows.filter(keep).reduce((total, r) => total + r.cents, 0);
      expect(m.rows.every((r) => monthOf(r.date) === m.month), m.month).toBe(true);
      expect(m.knownCents, `${m.month} known`).toBe(sum((r) => r.kind !== "income" && r.state === "known"));
      expect(m.estimateCents, `${m.month} estimate`).toBe(sum((r) => r.kind !== "income" && r.state === "estimate"));
      expect(m.incomeCents, `${m.month} income`).toBe(sum((r) => r.kind === "income"));
    }
    // November: the rent, the music and the insurance are known, the electricity is the series' typical sum
    const november = cal.months[1]!;
    expect(november.knownCents).toBe(RENT + MUSIC + INSURANCE);
    expect(november.estimateCents).toBe(typical(ctx, "Esimerkki Energia"));
    expect(november.rows.filter((r) => r.kind === "bill").map((r) => [r.payee, r.state]).sort()).toEqual([
      ["Esimerkki Energia", "estimate"],
      ["Esimerkki Musiikki", "known"],
      ["Esimerkki Vakuutus", "known"],
      ["Sato Oyj", "known"],
    ]);
  });

  it("is known for a fixed price and an estimate for a varying one, so known and estimate are the bills still to pay", () => {
    const { cal } = run(household());
    const bills = rowsOf(cal).filter((r) => r.kind === "bill" && r.state !== "paid");
    expect(bills.filter((r) => r.payee === "Esimerkki Energia").every((r) => r.state === "estimate")).toBe(true);
    expect(bills.filter((r) => r.payee !== "Esimerkki Energia").every((r) => r.state === "known")).toBe(true);
    const total = cal.months.reduce((sum, m) => sum + m.knownCents + m.estimateCents, 0);
    expect(total).toBe(bills.reduce((sum, r) => sum + r.cents, 0));
    expect(bills.length).toBeGreaterThan(0);
  });

  it("lists a quarterly series in every third month", () => {
    const { cal } = run(household());
    const months = cal.months.flatMap((m, i) => (m.rows.some((r) => r.payee === "Esimerkki Vakuutus") ? [i] : []));
    expect(months).toEqual([1, 4, 7, 10]);
    expect(rowsOf(cal).filter((r) => r.payee === "Esimerkki Vakuutus").every((r) => r.cents === INSURANCE)).toBe(true);
    // the year of rare bills is the four charges, which `upcoming` counts alike
    expect(cal).toMatchObject({ yearlyCents: 4 * INSURANCE, reserveMonthlyCents: (4 * INSURANCE) / 12 });
    expect(upcomingReport(run(household()).ctx, NO_INPUTS).yearlyCents).toBe(cal.yearlyCents);
  });

  it("shows a charge of this month as paid and leaves it out of what is still to come", () => {
    const { cal } = run(household());
    const october = cal.months[0]!;
    expect(october.rows.filter((r) => r.kind === "bill").map((r) => [r.payee, r.date, r.cents, r.state]).sort()).toEqual([
      ["Esimerkki Energia", "2026-10-10", power("2026-10"), "paid"],
      ["Esimerkki Musiikki", "2026-10-05", MUSIC, "paid"],
      ["Sato Oyj", "2026-10-01", RENT, "paid"],
    ]);
    expect(october).toMatchObject({ knownCents: 0, estimateCents: 0 });
    // the same charge, a month on, is a bill to come
    expect(cal.months[1]!.knownCents).toBeGreaterThan(0);
  });

  it("takes the charge of the same month last year for a varying monthly bill, so the winter costs more", () => {
    const { ctx, cal } = run(household());
    const usual = typical(ctx, "Esimerkki Energia");
    const row = (month: string) => cal.months.find((m) => m.month === month)!.rows.find((r) => r.payee === "Esimerkki Energia")!;
    // beyond the window of Nyt every month is the charge of the same month a year ago
    for (const month of FIRST_MONTHS.slice(2)) expect(row(month), month).toMatchObject({ cents: power(`${Number(month.slice(0, 4)) - 1}${month.slice(4)}`), state: "estimate" });
    expect(row("2027-01").cents).toBe(power("2026-01"));
    expect(row("2027-01").cents).not.toBe(usual);
    expect(row("2027-06").cents).toBe(power("2026-06"));
    expect(row("2027-06").cents).toBeLessThan(usual);
    // inside the window of Nyt the typical sum stays, as Nyt counts it
    expect(row("2026-11").cents).toBe(usual);
  });

  it("adds this month's bills up to the payday to the bills of Nyt", () => {
    const { ctx, cal } = run(household());
    const answer = nytAnswer(ctx, aheadBasis(ctx, [{ id: "own", name: own.name, type: own.type, balanceCents: 500_000, ownerName: null, balanceAt: `${TODAY}T06:00:00Z` }], NO_INPUTS));
    if (!answer.left.known) throw new Error(`no sum: ${answer.left.reason}`);
    expect(answer.left.payday?.date).toBe(PAYDAY);
    const before = rowsOf(cal).filter((r) => r.kind !== "income" && r.state !== "paid" && r.date < PAYDAY);
    // the rent, the music and the electricity of November
    expect(before.map((r) => r.payee).sort()).toEqual(["Esimerkki Energia", "Esimerkki Musiikki", "Sato Oyj"]);
    expect(before.reduce((sum, r) => sum + r.cents, 0)).toBe(answer.left.billsCents);
    expect(answer.left.billsCents).toBeGreaterThan(0);
  });

  it("has the pays found as known, and the regular pay beyond them as an estimate", () => {
    const { cal } = run(household());
    const income = (i: number) => cal.months[i]!.rows.filter((r) => r.kind === "income");
    expect(income(0)).toEqual([]);
    for (const i of [1, 2, 3]) expect(income(i).map((r) => [r.cents, r.state]), cal.months[i]!.month).toEqual([[PAY, "known"]]);
    for (const i of [4, 5, 6, 7, 8, 9, 10, 11]) expect(income(i).map((r) => [r.cents, r.state]), cal.months[i]!.month).toEqual([[PAY, "estimate"]]);
    expect(cal.months[1]!.incomeCents).toBe(PAY);
  });

  it("has no row of 0 cents: a bill whose sum is not known is counted instead", () => {
    const known = run(household(), withBills(typedBill("Esimerkki Vero", 5_000, "2026-12-05")));
    expect(rowsOf(known.cal).find((r) => r.payee === "Esimerkki Vero")).toMatchObject({ cents: 5_000, state: "known", kind: "bill", date: "2026-12-05" });
    expect(known.cal.unknownCount).toBe(0);
    const unknown = run(household(), withBills(typedBill("Esimerkki Vero", 0, "2026-12-05")));
    expect(rowsOf(unknown.cal).some((r) => r.payee === "Esimerkki Vero")).toBe(false);
    expect(unknown.cal.unknownCount).toBe(1);
    expect(rowsOf(unknown.cal).every((r) => r.cents > 0)).toBe(true);
  });

  it("counts a bill typed in under the name of a bill the history found once", () => {
    const rows = household();
    // the typed sum is far from the series' last charge, so only the name tells it is the same bill
    const typed = withBills(typedBill("Esimerkki Vakuutus", 30_000, "2026-11-19", "quarterly"));
    const { cal } = run(rows, typed);
    const found = rowsOf(cal).filter((r) => r.payee === "Esimerkki Vakuutus");
    expect(found.map((r) => r.cents)).toEqual([INSURANCE, INSURANCE, INSURANCE, INSURANCE]);
    expect(found.every((r) => r.seriesId !== null)).toBe(true);
    expect(cal.yearlyCents).toBe(4 * INSURANCE);
    // a typed bill of another name is its own row
    const other = run(rows, withBills(typedBill("Esimerkki Ajoneuvovero", 30_000, "2026-11-19", "quarterly")));
    expect(rowsOf(other.cal).filter((r) => r.payee === "Esimerkki Ajoneuvovero")).toHaveLength(4);
  });

  it("is the loan's row when a series pays a loan, and no second row of the series", () => {
    const loan: Loan = {
      id: "loan-1", name: "Asuntolaina", lender: "ESIMERKKIPANKKI", kind: "mortgage", grantedCents: null, balanceCents: 14_823_055, balanceDate: "2026-09-15", rateBp: 310,
      reference: "euribor_12", marginBp: 65, repayment: "annuity", intervalMonths: 1, paymentCents: 91_240, endDate: null, limitCents: null, seriesKey: null,
    };
    const instalments = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) =>
      tx({ accountId: "own", bookingDate: `${m}-02`, amountCents: -91_240, merchant: "ESIMERKKIPANKKI", counterparty: "ESIMERKKIPANKKI", category: "mortgage" }),
    );
    const today = "2026-10-09";
    const without = run(instalments, NO_INPUTS, today);
    // the charge of this month and the eleven months after it
    expect(rowsOf(without.cal).filter((r) => r.kind === "bill" && r.payee === "ESIMERKKIPANKKI")).toHaveLength(12);
    const { ctx, cal } = run(instalments, { marks: [], expectedBills: [], loans: [loan] }, today);
    const rows = rowsOf(cal);
    const loanRows = rows.filter((r) => r.kind === "loan");
    // one row a month: the instalment of October was charged on the 2nd, so the plan's of the 15th is no second one
    expect(loanRows).toHaveLength(12);
    expect(loanRows.map((r) => monthOf(r.date))).toEqual(FIRST_MONTHS);
    expect(loanRows[0]).toMatchObject({ date: "2026-10-02", cents: 91_240, state: "paid" });
    expect(loanRows.slice(1).every((r) => r.state === "known")).toBe(true);
    expect(loanRows.every((r) => r.payee === "Asuntolaina" && r.cents > 0 && r.seriesId === ctx.recurring[0]!.id)).toBe(true);
    expect(cal.months[0]).toMatchObject({ knownCents: 0, estimateCents: 0 });
    expect(rows.filter((r) => r.kind === "bill")).toEqual([]);
  });

  it("has the whole balance of a loan with one payment on its last day, as a row on that day", () => {
    const bullet: Loan = {
      id: "loan-2", name: "Autolaina", lender: "ESIMERKKIPANKKI", kind: "car", grantedCents: null, balanceCents: 500_000, balanceDate: "2026-10-01", rateBp: null,
      reference: null, marginBp: null, repayment: "bullet", intervalMonths: null, paymentCents: null, endDate: "2027-03-31", limitCents: null, seriesKey: null,
    };
    const { cal } = run([], { marks: [], expectedBills: [], loans: [bullet] });
    expect(rowsOf(cal).map((r) => [r.date, r.payee, r.cents, r.state, r.kind])).toEqual([["2027-03-31", "Autolaina", 500_000, "known", "loan"]]);
    expect(cal.months[5]!.knownCents).toBe(500_000);
    expect(cal.unknownCount).toBe(0);
    // a loan that owes nothing has no row of 0 cents
    expect(rowsOf(run([], { marks: [], expectedBills: [], loans: [{ ...bullet, balanceCents: 0 }] }).cal)).toEqual([]);
    // a last day past the twelve months is no row
    expect(rowsOf(run([], { marks: [], expectedBills: [], loans: [{ ...bullet, endDate: "2027-10-31" }] }).cal)).toEqual([]);
  });

  it("has a regular saving as a row of its own kind, in no sum of the bills", () => {
    const saving = MONTHS.map((m) => tx({ accountId: "own", bookingDate: `${m}-20`, amountCents: -20_000, merchant: "Esimerkki Rahasto", category: "investments" }));
    const { cal } = run([...household(), ...saving]);
    const row = rowsOf(cal).filter((r) => r.payee === "Esimerkki Rahasto");
    expect(row).toHaveLength(12);
    expect(row.every((r) => r.kind === "saving")).toBe(true);
    const november = cal.months[1]!;
    expect(november.savingCents).toBe(20_000);
    expect(november.knownCents).toBe(RENT + MUSIC + INSURANCE);
    expect(cal.months[0]!.savingCents).toBe(0);
  });

  it("takes the largest charge of the month a year ago, not what two charges add up to", () => {
    const extra = tx({ accountId: "own", bookingDate: "2025-12-12", amountCents: -2_500, merchant: "Esimerkki Energia", category: "utilities" });
    const { cal } = run([...household(), extra]);
    const december = cal.months.find((m) => m.month === "2026-12")!.rows.find((r) => r.payee === "Esimerkki Energia")!;
    expect(december.cents).toBe(power("2025-12"));
  });

  it("has an estimated pay on the days of its cadence, every one of a month", () => {
    const fortnight: Transaction[] = [];
    for (let d = "2026-03-06"; d <= TODAY; d = addDays(d, 14)) fortnight.push(tx({ accountId: "own", bookingDate: d, amountCents: 150_000, merchant: "Esimerkki Oy", category: "salary" }));
    const { cal } = run(fortnight);
    const pay = (month: string) => cal.months.find((m) => m.month === month)!.rows.filter((r) => r.kind === "income");
    expect(pay("2027-02").map((r) => [r.date, r.state])).toEqual([["2027-02-05", "estimate"], ["2027-02-19", "estimate"]]);
    // a fortnight gives three pays in a month now and then
    expect(pay("2027-04").map((r) => r.date)).toEqual(["2027-04-02", "2027-04-16", "2027-04-30"]);
    expect(cal.months.find((m) => m.month === "2027-04")!.incomeCents).toBe(3 * 150_000);
  });

  describe("the sums a month shows", () => {
    const saving = () => MONTHS.map((m) => tx({ accountId: "own", bookingDate: `${m}-20`, amountCents: -20_000, merchant: "Esimerkki Rahasto", category: "investments" }));
    const rowSum = (rows: readonly { cents: number }[]) => rows.reduce((total, r) => total + r.cents, 0);

    it("has the bills of a month as its known and estimated bills together, and the twelve months as the calendar's bills", () => {
      const { cal } = run([...household(), ...saving()]);
      for (const m of cal.months) {
        const bills = m.rows.filter((r) => (r.kind === "bill" || r.kind === "loan") && r.state !== "paid" && !r.onCard);
        expect(m.billsCents, m.month).toBe(rowSum(bills));
        expect(m.billsCents, m.month).toBe(m.knownCents + m.estimateCents);
      }
      expect(cal.billsCents).toBe(cal.months.reduce((total, m) => total + rowSum(m.rows.filter((r) => (r.kind === "bill" || r.kind === "loan") && r.state !== "paid" && !r.onCard)), 0));
    });

    it("has what is left after the bills as the pays less the bills and the regular saving, to the cent", () => {
      const { ctx, cal } = run([...household(), ...saving()]);
      for (const m of cal.months) expect(m.afterCents, m.month).toBe(m.incomeCents - m.billsCents - m.savingCents);
      const november = cal.months[1]!;
      expect(november.afterCents).toBe(PAY - (RENT + MUSIC + INSURANCE + typical(ctx, "Esimerkki Energia")) - 20_000);
    });

    it("leaves a bill on a card or an account the balance does not count out of every sum, and counts it apart", () => {
      const other: Account = { id: "other", name: "Muu tili", iban: null, currency: "EUR", type: "savings" };
      const balances: BalanceInput[] = [
        { id: "own", name: "Käyttötili", type: "checking", balanceCents: 500_000, ownerName: null, balanceAt: TODAY },
        { id: "other", name: "Muu tili", type: "savings", balanceCents: 0, ownerName: null, balanceAt: TODAY },
      ];
      const magazine = MONTHS.map((m) => tx({ accountId: "other", bookingDate: `${m}-07`, amountCents: -2_500, merchant: "Esimerkki Lehti", category: "entertainment" }));
      const ctx = createContext([...household(), ...magazine], [own, other], TODAY);
      const cal = billCalendar(ctx, NO_INPUTS, balances);
      const november = cal.months[1]!;
      const row = november.rows.find((r) => r.payee === "Esimerkki Lehti");
      expect(row).toMatchObject({ cents: 2_500, onCard: true, monthly: true });
      expect(november.knownCents).toBe(RENT + MUSIC + INSURANCE);
      expect(november.billsCents).toBe(november.knownCents + november.estimateCents);
      expect(november.monthlyBillsCount).toBe(3);
      expect(november.monthlyBillsCents).toBe(RENT + MUSIC + typical(ctx, "Esimerkki Energia"));
      expect(november.afterCents).toBe(november.incomeCents - november.billsCents - november.savingCents);
    });

    it("counts the monthly bills of a month and adds them up, to the cent", () => {
      const { ctx, cal } = run([...household(), ...saving()]);
      for (const m of cal.months) {
        const monthly = m.rows.filter((r) => r.monthly === true && r.state !== "paid");
        const bills = monthly.filter((r) => (r.kind === "bill" || r.kind === "loan") && !r.onCard);
        expect([m.monthlyBillsCount, m.monthlyBillsCents], m.month).toEqual([bills.length, rowSum(bills)]);
      }
      // November: the quarterly insurance is no monthly bill
      const november = cal.months[1]!;
      expect(november.monthlyBillsCount).toBe(3);
      expect(november.monthlyBillsCents).toBe(RENT + MUSIC + typical(ctx, "Esimerkki Energia"));
      expect(november.rows.find((r) => r.payee === "Esimerkki Vakuutus")!.monthly).toBeUndefined();
    });

    it("gives no figure for what is left while a bill's sum is not known, however many months have rows", () => {
      const { cal } = run(household(), withBills(typedBill("Esimerkki Vero", 0, "2026-12-05")));
      expect(cal.unknownCount).toBe(1);
      expect(cal.months.map((m) => m.afterCents)).toEqual(Array.from({ length: 12 }, () => null));
      expect(cal.months[1]!.billsCents).toBe(RENT + MUSIC + INSURANCE + cal.months[1]!.estimateCents);
    });
  });
});
