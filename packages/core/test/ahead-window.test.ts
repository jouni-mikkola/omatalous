import { describe, expect, it } from "vitest";
import { contextOf } from "../../../tools/findings/households.ts";
import { partCents } from "../src/account-use.ts";
import { cashAhead } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { expectedBillRows } from "../src/analysis/forecast.ts";
import { addDays } from "../src/dates.ts";
import { type Account, type BalanceInput, type ExpectedBill, type IsoDate, NO_INPUTS, type Part, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { steadyHousehold } from "./kit/household.ts";
import { EVENTS, KIT_SEED, kitHousehold } from "./kit/index.ts";

const TODAY = "2026-10-09";
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const joint: Account = { id: "joint", name: "Yhteinen tili", iban: "FI14 1009 3000 1234 58", currency: "EUR", type: "checking" };
const savings: Account = { id: "sav", name: "Säästötili", iban: "FI55 1009 3000 7654 32", currency: "EUR", type: "savings" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };

const WHOLE: Part = { from: 0, to: 1, of: 1 };
const HALF: Part = { from: 0, to: 1, of: 2 };
const OTHER_HALF: Part = { from: 1, to: 2, of: 2 };

const everyDay = (until: IsoDate, row: (day: IsoDate) => Transaction[]): Transaction[] => {
  const rows: Transaction[] = [];
  for (let d = "2026-03-01"; d <= until; d = addDays(d, 1)) rows.push(...row(d));
  return rows;
};
/** Day `day` of each month from March 2026 up to `until`. */
const monthly = (day: number, until: IsoDate = TODAY): IsoDate[] =>
  ["03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m) => `2026-${m}-${String(day).padStart(2, "0")}`).filter((d) => d <= until);

/** A household with no surprises on `account`: 20 euros of groceries a day and a rent of 900 on the 2nd. */
const home = (account = "own", until: IsoDate = TODAY): Transaction[] =>
  everyDay(until, (d) => [
    tx({ accountId: account, bookingDate: d, amountCents: -2000, merchant: "Ruokakauppa", category: "groceries" }),
    ...(d.endsWith("-02") ? [tx({ accountId: account, bookingDate: d, amountCents: -90_000, merchant: "Vuokranantaja Oy", category: "housing" })] : []),
  ]);
/** Both legs of an own transfer, as the pipeline leaves them. The leg that leaves names the other account when it has an IBAN. */
const move = (from: Account, to: Account, bookingDate: IsoDate, cents: number): Transaction[] => [
  tx({ accountId: from.id, bookingDate, amountCents: -cents, merchant: "Oma siirto", category: "transfer", categorySource: "transfer", isTransfer: true, counterpartyIban: to.iban }),
  tx({ accountId: to.id, bookingDate, amountCents: cents, merchant: "Oma siirto", category: "transfer", categorySource: "transfer", isTransfer: true, counterpartyIban: from.iban }),
];
/** The rows of `account` as a member's own view holds them at `part` (what `applyUse` does when the view is loaded). */
const cut = (rows: readonly Transaction[], account: string, part: Part): Transaction[] =>
  rows.map((t) => (t.accountId === account ? { ...t, amountCents: partCents(t.amountCents, part), wholeCents: t.amountCents } : t));
const bal = (a: Account, balanceCents: number | null, extra: Partial<BalanceInput> = {}): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents, ownerName: null, balanceAt: `${TODAY}T06:00:00Z`, ...extra });

/** Ten euros a day on the card, and its bill paid from the own account on the 20th: March's first. */
const BILLS = [30_000, 31_000, 29_000, 30_500, 29_500, 30_000, 30_000];
const cardRows = (bills: readonly number[] = BILLS, until: IsoDate = TODAY, first = 0): Transaction[] => [
  ...everyDay(until, (d) => [tx({ accountId: "card", bookingDate: d, amountCents: -1000, merchant: "Kahvila", category: "restaurants" })]),
  ...monthly(20).flatMap((d, i) => (i >= first && bills[i] ? move(own, card, d, bills[i]!) : [])),
];
const sumOfWalk = (d: ReturnType<typeof cashAhead>) =>
  d.balance!.startCents + d.totals.incomeCents - d.totals.recurringCents - d.totals.typedCents - d.totals.cardCents - d.totals.transferCents - d.totals.everydayCents;
const of = (d: ReturnType<typeof cashAhead>, source: string) => d.rows.filter((r) => r.source === source);

describe("the window: a connected card", () => {
  const on = (day: IsoDate, balances: BalanceInput[], bills = BILLS, first = 0) => cashAhead(createContext([...home("own", day), ...cardRows(bills, day, first)], [own, card], day), balances, NO_INPUTS);

  it("a bill of 412,00 is one row on its day, and the card's purchases are not in the everyday rate", () => {
    const d = on(TODAY, [bal(own, 200_000), bal(card, -41_200)]);
    expect(of(d, "card")).toEqual([{ date: "2026-10-20", name: "Luottokortti", category: "transfer", cents: -41_200, source: "card", basis: "balance" }]);
    // 20 euros a day leave the own account; the card's 10 a day are in its bill
    expect(d.everydayPerDayCents).toBe(2000);
    expect(d.totals).toMatchObject({ cardCents: 41_200, transferCents: 0, recurringCents: 90_000, everydayCents: 60_000 });
    expect(d.balance).toMatchObject({ counts: "all", accounts: 1, startCents: 200_000, last: { date: "2026-11-08", cents: 200_000 - 90_000 - 41_200 - 60_000 } });
    expect(d.balance!.last.cents).toBe(sumOfWalk(d));
    // Laskut's 30 days hold bills and subscriptions only
    expect(d.upcoming.map((r) => r.source)).toEqual(["recurring"]);
  });

  it("a card in credit owes nothing and is no row; money that came back to the card makes the bill smaller", () => {
    expect(of(on(TODAY, [bal(own, 200_000), bal(card, 5000)]), "card")).toEqual([]);
    expect(of(on(TODAY, [bal(own, 200_000), bal(card, -36_200)]), "card")[0]).toMatchObject({ cents: -36_200, basis: "balance" });
  });

  it("a card that is not paid in full, or whose balance the bank does not give, gets its usual bill", () => {
    // 100 euros a month against a debt of 3 000: what the card owes is not the next bill
    const partly = on(TODAY, [bal(own, 200_000), bal(card, -300_000)], [10_000, 10_500, 9500, 10_000, 10_400, 9800, 10_000]);
    expect(of(partly, "card")).toEqual([{ date: "2026-10-20", name: "Luottokortti", category: "transfer", cents: -10_000, source: "card", basis: "usual" }]);
    for (const balances of [[bal(own, 200_000)], [bal(own, 200_000), bal(card, null)]]) {
      expect(of(on(TODAY, balances), "card")[0]).toMatchObject({ date: "2026-10-20", cents: -30_000, basis: "usual" });
    }
  });

  it("a late bill is expected today at its usual sum, a bill six days late did not come, and after two bill days the card is not expected", () => {
    const balances = [bal(own, 200_000), bal(card, -41_200)];
    expect(of(on("2026-10-23", balances), "card")[0]).toEqual({ date: "2026-10-23", name: "Luottokortti", category: "transfer", cents: -30_000, source: "card", basis: "usual" });
    expect(of(on("2026-10-25", balances), "card").map((r) => r.date)).toEqual(["2026-10-25", "2026-11-20"]);
    expect(of(on("2026-10-26", balances), "card").map((r) => [r.date, r.basis])).toEqual([["2026-11-20", "balance"]]);
    expect(of(on("2026-11-26", balances), "card")).toEqual([]);
  });

  it("under three bills nothing is guessed, and three are enough", () => {
    const balances = [bal(own, 200_000), bal(card, -41_200)];
    expect(of(on(TODAY, balances, BILLS, 5), "card")).toEqual([]);
    expect(of(on(TODAY, balances, BILLS, 4), "card")).toHaveLength(1);
  });

  it("a card that is not connected: its bill is a row once, as an expected charge", () => {
    const bills = monthly(20).map((d, i) => tx({ accountId: "own", bookingDate: d, amountCents: -BILLS[i]!, merchant: "Korttiyhtiö", category: "card_bill" }));
    const d = cashAhead(createContext([...home(), ...bills], [own], TODAY), [bal(own, 200_000)], NO_INPUTS);
    expect(d.rows.filter((r) => r.name === "Korttiyhtiö")).toEqual([{ date: "2026-10-20", name: "Korttiyhtiö", category: "card_bill", cents: -30_000, source: "recurring" }]);
    expect(of(d, "card")).toEqual([]);
    expect(d.balance!.last.cents).toBe(sumOfWalk(d));
  });

  it("a subscription the card pays is in the card's bill: no row of the window, and still in Laskut's 30 days", () => {
    const music = monthly(11).map((d) => tx({ accountId: "card", bookingDate: d, amountCents: -1199, merchant: "Musiikkipalvelu", category: "subscriptions" }));
    const d = cashAhead(createContext([...home(), ...cardRows(), ...music], [own, card], TODAY), [bal(own, 200_000), bal(card, -41_200)], NO_INPUTS);
    expect(d.rows.map((r) => r.name)).toEqual(["Luottokortti", "Vuokranantaja Oy"]);
    expect(d.upcoming.map((r) => [r.date, r.name])).toEqual([["2026-10-11", "Musiikkipalvelu"], ["2026-11-02", "Vuokranantaja Oy"]]);
  });
});

describe("the window: own transfers and the accounts it counts", () => {
  const power = monthly(12).map((d) => tx({ accountId: "joint", bookingDate: d, amountCents: -8000, merchant: "Sähköyhtiö", category: "utilities" }));
  const toJoint = monthly(1).flatMap((d) => move(own, joint, d, 60_000));
  const rows = [...home(), ...toJoint, ...power];
  const household = (r: Transaction[] = rows) => cashAhead(createContext(r, [own, joint], TODAY), [bal(own, 200_000), bal(joint, 50_000)], NO_INPUTS);
  const mine = (r: Transaction[] = rows) => cashAhead(createContext(cut(r, "joint", HALF), [own, joint], TODAY), [bal(own, 200_000, { part: WHOLE }), bal(joint, 25_000, { part: HALF })], NO_INPUTS);

  it("600,00 on the 1st from the viewer's own account to the joint account is a row in the own view", () => {
    const d = mine();
    expect(of(d, "transfer")).toEqual([{ date: "2026-11-01", name: "Yhteinen tili", category: "transfer", cents: -60_000, source: "transfer" }]);
    expect(d.totals).toMatchObject({ transferCents: 60_000, cardCents: 0, recurringCents: 90_000 });
    expect(d.balance).toMatchObject({ counts: "own", accounts: 1, startCents: 200_000 });
    expect(d.balance!.last.cents).toBe(200_000 - 90_000 - 60_000 - 60_000);
    expect(d.balance!.last.cents).toBe(sumOfWalk(d));
    // the joint account's electricity bill is not paid from the counted account: Laskut has it at the viewer's part
    expect(d.rows.map((r) => r.name)).not.toContain("Sähköyhtiö");
    expect(d.upcoming.map((r) => [r.name, r.cents])).toEqual([["Sähköyhtiö", -4000], ["Vuokranantaja Oy", -90_000]]);
  });

  it("the household view counts both accounts: the transfer between them is no row and changes nothing", () => {
    const d = household();
    expect(of(d, "transfer")).toEqual([]);
    expect(d.balance).toMatchObject({ counts: "all", accounts: 2, startCents: 250_000 });
    const without = household([...home(), ...power]);
    expect(d.rows).toEqual(without.rows);
    expect(d.balance!.days).toEqual(without.balance!.days);
    expect(d.rows.map((r) => r.name)).toEqual(["Sähköyhtiö", "Vuokranantaja Oy"]);
  });

  it("money that comes back from the joint account is no row, and two transfers are not a habit yet", () => {
    const back = monthly(3).flatMap((d) => move(joint, own, d, 10_000));
    expect(of(mine([...rows, ...back]), "transfer").map((r) => r.cents)).toEqual([-60_000]);
    const two = [...home(), ...monthly(1).slice(-2).flatMap((d) => move(own, joint, d, 60_000))];
    expect(of(mine(two), "transfer")).toEqual([]);
    expect(of(mine([...home(), ...monthly(1).slice(-3).flatMap((d) => move(own, joint, d, 60_000))]), "transfer")).toHaveLength(1);
    // ten Fridays of 50 euros: regular, and not monthly
    const weekly = Array.from({ length: 10 }, (_, k) => move(own, joint, addDays("2026-08-07", 7 * k), 5000)).flat();
    expect(of(mine([...home(), ...weekly]), "transfer")).toEqual([]);
  });

  it("a transfer to a connected savings account is a row, and a savings plan to an account that is not connected is a row once", () => {
    const saved = monthly(26).flatMap((d) => move(own, savings, d, 30_000));
    const d = cashAhead(createContext([...home(), ...saved], [own, savings], TODAY), [bal(own, 200_000), bal(savings, 900_000)], NO_INPUTS);
    expect(of(d, "transfer")).toEqual([{ date: "2026-10-26", name: "Säästötili", category: "transfer", cents: -30_000, source: "transfer" }]);
    const plan = monthly(26).map((bookingDate) => tx({ accountId: "own", bookingDate, amountCents: -30_000, merchant: "Rahastoyhtiö", category: "investments" }));
    const p = cashAhead(createContext([...home(), ...plan], [own], TODAY), [bal(own, 200_000)], NO_INPUTS);
    expect(p.rows.filter((r) => r.cents === -30_000)).toEqual([{ date: "2026-10-26", name: "Rahastoyhtiö", category: "investments", cents: -30_000, source: "recurring" }]);
  });

  it("a viewer whose only checking account is joint at 1 and 1: counted at the part, and the last day is half of the household's, to the cent", () => {
    const all = home("joint");
    const whole = cashAhead(createContext(all, [joint], TODAY), [bal(joint, 200_001)], NO_INPUTS);
    const part = (p: Part) => cashAhead(createContext(cut(all, "joint", p), [joint], TODAY), [bal(joint, partCents(200_001, p), { part: p })], NO_INPUTS);
    const [first, second] = [part(HALF), part(OTHER_HALF)];
    expect(whole.balance).toMatchObject({ counts: "all", startCents: 200_001 });
    expect(first.balance).toMatchObject({ counts: "part", accounts: 1, startCents: 100_001 });
    expect(first.everydayPerDayCents).toBe(1000);
    expect(first.rows).toEqual([{ date: "2026-11-02", name: "Vuokranantaja Oy", category: "housing", cents: -45_000, source: "recurring" }]);
    // the two users' windows add up to the household's, the odd cent of the balance with one of them
    expect(first.balance!.last.cents + second.balance!.last.cents).toBe(whole.balance!.last.cents);
    expect(second.balance!.last.cents * 2).toBe(whole.balance!.last.cents - 1);
  });

  it("other pay is a row only when a counted account gets it; the payday is the view's", () => {
    const pay = monthly(15).map((d) => tx({ accountId: "own", bookingDate: d, amountCents: 300_000, merchant: "Työnantaja Oy", category: "salary" }));
    const benefit = monthly(12).map((d) => tx({ accountId: "joint", bookingDate: d, amountCents: 20_000, merchant: "Kela", category: "benefits" }));
    const [h, m] = [household([...rows, ...pay, ...benefit]), mine([...rows, ...pay, ...benefit])];
    expect([h.payday!.name, m.payday!.name]).toEqual(["Työnantaja Oy", "Työnantaja Oy"]);
    expect(of(h, "income").map((r) => [r.name, r.cents])).toEqual([["Kela", 20_000]]);
    expect(of(m, "income")).toEqual([]);
    expect(m.balance!.last.cents).toBe(sumOfWalk(m));
  });

  it("without a checking account in view nothing is left out", () => {
    const d = cashAhead(createContext(rows, [own, joint], TODAY), [bal(savings, 900_000)], NO_INPUTS);
    expect(d).toMatchObject({ balance: null, missing: "balance" });
    expect(d.rows.map((r) => r.name)).toEqual(["Sähköyhtiö", "Vuokranantaja Oy"]);
  });
});

describe("a typed-in bill is dropped only when it is paid or a series carries it", () => {
  const phone = monthly(25).map((d) => tx({ accountId: "own", bookingDate: d, amountCents: -9850, merchant: "Puhelin Oy", category: "phone_internet" }));
  const base = [...home(), ...phone];
  const bill = (name: string, amountCents: number, dueDate = "2026-10-20"): ExpectedBill => ({ id: name, name, amountCents, dueDate, cadence: "once", category: null });
  const left = (rows: Transaction[], ...bills: ExpectedBill[]) => expectedBillRows(createContext(rows, [own], TODAY), bills, TODAY, "2026-11-08").map((r) => r.name);
  const once = (merchant: string, amountCents: number, extra: Partial<Transaction> = {}) => tx({ accountId: "own", bookingDate: "2026-10-05", amountCents, merchant, category: "health", ...extra });

  it("a bill of 100,00 stays beside the rent of the same payee and a phone bill of 98,50", () => {
    // the rent of 2.10. has the bill's name and the phone bill of 25.9. its size: both are charges of their own series
    expect(left(base, bill("Vuokranantaja Oy", 10_000), bill("Hammaslääkäri", 10_000))).toEqual(["Vuokranantaja Oy", "Hammaslääkäri"]);
    const d = cashAhead(createContext(base, [own], TODAY), [bal(own, 200_000)], { ...NO_INPUTS, expectedBills: [bill("Vuokranantaja Oy", 10_000)] });
    expect(d.totals).toMatchObject({ typedCents: 10_000, recurringCents: 90_000 + 9850 });
    expect(d.balance!.last.cents).toBe(sumOfWalk(d));
  });

  it("a row with no series pays it by its size or by its payee, and money in pays nothing", () => {
    expect(left([...base, once("Hammaslääkäri Oy", -9850)], bill("Hammaslääkäri", 10_000))).toEqual([]);
    expect(left([...base, once("Hammaslääkäri Oy", -18_000)], bill("Hammaslääkäri Oy", 10_000))).toEqual([]);
    // another payee and another size, a row booked more than 31 days before the due date, a refund, an own transfer
    expect(left([...base, once("Hammaslääkäri Oy", -18_000)], bill("Hammaslääkäri", 10_000))).toEqual(["Hammaslääkäri"]);
    expect(left([...base, once("Hammaslääkäri Oy", -9850, { bookingDate: "2026-09-18" })], bill("Hammaslääkäri", 10_000))).toEqual(["Hammaslääkäri"]);
    expect(left([...base, once("Hammaslääkäri Oy", 10_000)], bill("Hammaslääkäri Oy", 10_000))).toEqual(["Hammaslääkäri Oy"]);
    expect(left([...base, once("Hammaslääkäri Oy", -10_000, { isTransfer: true })], bill("Hammaslääkäri Oy", 10_000))).toEqual(["Hammaslääkäri Oy"]);
  });

  it("a row cut to a member's part pays the whole bill by the bank's amount", () => {
    expect(left([...base, once("Hammaslääkäri Oy", -5000, { wholeCents: -10_000 })], bill("Hammaslääkäri", 10_000))).toEqual([]);
    expect(left([...base, once("Hammaslääkäri Oy", -5000)], bill("Hammaslääkäri", 10_000))).toEqual(["Hammaslääkäri"]);
  });

  it("a bill typed with the name and the size of a series is that series' charge, counted once; another size is another bill", () => {
    expect(left(base, bill("Vuokranantaja Oy", 90_000, "2026-11-02"))).toEqual([]);
    expect(left(base, bill("Vuokranantaja Oy", 45_000, "2026-11-02"))).toEqual(["Vuokranantaja Oy"]);
    // the rent stopped coming: no series expects it, so the typed bill is the only one
    const stopped = base.filter((t) => t.merchant !== "Vuokranantaja Oy" || t.bookingDate < "2026-09-01");
    expect(left(stopped, bill("Vuokranantaja Oy", 90_000, "2026-11-02"))).toEqual(["Vuokranantaja Oy"]);
  });
});

describe("start plus income less bills, card, transfers and everyday spending is the last day's balance", () => {
  it("in every household of the kit, to the cent", () => {
    for (const h of [kitHousehold(null), ...EVENTS.map(kitHousehold)]) {
      const d = cashAhead(contextOf(h), h.balances, h.inputs);
      expect(d.balance, h.name).not.toBeNull();
      expect(d.balance!.last.cents, h.name).toBe(sumOfWalk(d));
      expect(d.rows.every((r) => r.date >= d.from && r.date <= d.to), h.name).toBe(true);
    }
  });

  it("with the Gold card's bill inside the window, at what the card owes", () => {
    const h = steadyHousehold(KIT_SEED, "poisson", "2026-10-27");
    const d = cashAhead(contextOf(h), h.balances, h.inputs);
    const owed = -h.balances.find((b) => b.id === "card")!.balanceCents!;
    expect(of(d, "card")).toEqual([{ date: "2026-11-10", name: "Nordea Gold", category: "transfer", cents: -owed, source: "card", basis: "balance" }]);
    expect(d.totals.cardCents).toBe(owed);
    expect(d.balance!.last.cents).toBe(sumOfWalk(d));
  });
});
