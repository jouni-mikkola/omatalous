import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { categoryTotals } from "../src/analysis/category-totals.ts";
import { createContext, spendRows } from "../src/analysis/context.ts";
import { toDayRange } from "../src/analysis/period.ts";
import { marksBySubject, seriesMarkSubject } from "../src/analysis/subscription-alerts.ts";
import { expectedCharges, isContract, isEndedContract } from "../src/commitments.ts";
import { addDays } from "../src/dates.ts";
import { enrichIsland, enrichTransactions } from "../src/pipeline.ts";
import { type Account, NO_INPUTS, type Transaction, type UserMark } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";
const LESSOR = { merchant: "ESIMERKKI LEASING OY", counterparty: "ESIMERKKI LEASING OY" };

/** A lease: a first rent of 3000 €, then 24 rents of 399 €, the last on 2026-01-05. */
const lease = (): Transaction[] => [
  tx({ bookingDate: "2024-01-05", amountCents: -300000, category: "leasing", categorySource: "user", ...LESSOR }),
  ...series("2024-02-05", 30.44, 24, -39900, { category: "leasing", categorySource: "user", ...LESSOR }),
];
const refund = (euros: number, date = "2026-02-12"): Transaction =>
  tx({ bookingDate: date, amountCents: euros * 100, category: "income", categorySource: "default", ...LESSOR });

// the day's groceries: the history runs to `now`, as a household's does, so the lessor's last row is not its today
const dayRow = (now: string): Transaction => tx({ bookingDate: addDays(now, -1), amountCents: -1500, merchant: "Prisma", category: "groceries" });
const contextOf = (rows: Transaction[], extra: Transaction[] = [], now = today) => {
  rows = [...rows, ...extra, dayRow(now)];
  const changed = new Map(enrichTransactions(rows, [checking], []).map((t) => [t.id, t]));
  return createContext(rows.map((t) => changed.get(t.id) ?? t), [checking], now);
};
const all = { fromDay: -1e9, toDay: 1e9 };
const totals = (ctx: ReturnType<typeof contextOf>) => {
  const rows = spendRows(ctx, all);
  const income = rows.reduce((sum, t) => sum + t.flows.income, 0);
  const leasing = categoryTotals(rows).find((c) => c.category === "leasing")?.cents ?? 0;
  return { income, leasing };
};

describe("a contract from a series", () => {
  it("tells the start, the first payment, the monthly cost, the end and the refund of a lease", () => {
    const ctx = contextOf([...lease(), refund(1800)]);
    const s = ctx.recurring.find((r) => r.merchant === LESSOR.merchant)!;
    expect(s.contract).toEqual({
      startDate: "2024-01-05",
      firstPaymentCents: 300000,
      lastDate: addDays("2024-02-05", Math.round(23 * 30.44)),
      ended: true,
      endedOn: "2026-02-12",
      monthlyCents: 39900,
      totalPaidCents: 300000 + 24 * 39900,
      refund: { date: "2026-02-12", cents: 180000 },
      costAfterRefundCents: 300000 + 24 * 39900 - 180000,
    });
    expect(s.active).toBe(false);
  });

  it("nets the closing refund against the contract's category and leaves the income as it was", () => {
    const before = totals(contextOf(lease()));
    const after = totals(contextOf([...lease(), refund(1800)]));
    expect(after.leasing).toBe(before.leasing - 180000);
    expect(after.income).toBe(before.income);
    // one source: the panel says what the totals took off
    const s = contextOf([...lease(), refund(1800)]).recurring.find((r) => r.merchant === LESSOR.merchant)!;
    expect(s.contract!.refund!.cents).toBe(before.leasing - after.leasing);
  });

  it("a second lease from the same lessor later does not undo the first one's refund", () => {
    const lease2 = [
      tx({ bookingDate: "2026-05-05", amountCents: -300000, category: "leasing", categorySource: "user", ...LESSOR }),
      ...series("2026-06-05", 30.44, 5, -45000, { category: "leasing", categorySource: "user", ...LESSOR }),
    ];
    const without = totals(contextOf([...lease(), ...lease2]));
    const ctx = contextOf([...lease(), refund(1800), ...lease2]);
    const withRefund = totals(ctx);
    expect(withRefund.leasing).toBe(without.leasing - 180000);
    expect(withRefund.income).toBe(without.income);
    const runs = ctx.recurring.filter((r) => r.merchant === LESSOR.merchant);
    const first = runs.find((r) => r.typicalAmountCents === 39900)!;
    const second = runs.find((r) => r.typicalAmountCents === 45000)!;
    expect(first.contract).toMatchObject({ ended: true, refund: { cents: 180000 }, firstPaymentCents: 300000, startDate: "2024-01-05" });
    expect(second.contract).toMatchObject({ ended: false, refund: null, firstPaymentCents: 300000, startDate: "2026-05-05" });
  });

  it("a credit note while the contract runs stays income, also when the next payment comes", () => {
    const INSURER = { merchant: "ESIMERKKI VAKUUTUS OY", counterparty: "ESIMERKKI VAKUUTUS OY" };
    const pay = series("2025-11-05", 30.44, 12, -10000, { category: "insurance", categorySource: "user", ...INSURER });
    const credit = tx({ bookingDate: "2026-10-15", amountCents: 60000, category: "income", categorySource: "default", ...INSURER });
    const next = tx({ bookingDate: "2026-11-05", amountCents: -10000, category: "insurance", categorySource: "user", ...INSURER });
    const insurance = (rows: Transaction[], extra: Transaction[], now: string) => {
      const t = totals(contextOf(rows, extra, now));
      const rowsOf = spendRows(contextOf(rows, extra, now), all);
      return { income: t.income, cents: categoryTotals(rowsOf).find((c) => c.category === "insurance")?.cents ?? 0 };
    };
    const plain = insurance(pay, [], "2026-10-20");
    expect(insurance(pay, [credit], "2026-10-20")).toEqual({ income: plain.income + 60000, cents: plain.cents });
    const later = insurance(pay, [next], "2026-11-20");
    expect(insurance(pay, [credit, next], "2026-11-20")).toEqual({ income: later.income + 60000, cents: later.cents });
  });

  it("the pipeline pairs a refund that is the newest row once the day it is given is 76 or more days after the last payment", () => {
    const rows = [...lease(), refund(1800)];
    const refundRow = (today?: string) => enrichTransactions(rows, [checking], [], undefined, undefined, undefined, today).find((t) => t.id === rows.at(-1)!.id);
    // the last rent is on 2026-01-05: day 75 is 2026-03-21
    expect(refundRow("2026-03-25")).toMatchObject({ category: "leasing", categorySource: "match" });
    expect(refundRow("2026-03-10")).toBeUndefined();
    // with no day given the newest booked row is the day, and the refund is that row: nothing says the contract ended
    expect(refundRow()).toBeUndefined();
  });

  it("a pending row dated ahead is no evidence of the day", () => {
    const ahead = tx({ bookingDate: "2026-04-30", amountCents: -1500, merchant: "Prisma", category: "groceries", status: "pending" });
    const rows = [...lease(), refund(1800), dayRow("2026-03-10"), ahead];
    expect(enrichTransactions(rows, [checking], []).find((t) => t.id === rows[rows.length - 3]!.id)).toBeUndefined();
  });

  it("a merchant island gives the answer of the full run, given the same day", () => {
    const rows = [...lease(), refund(1800)];
    const full = enrichTransactions(rows, [checking], [], undefined, undefined, undefined, today);
    const stored = rows.map((t) => full.find((c) => c.id === t.id) ?? t);
    expect(stored.at(-1)).toMatchObject({ category: "leasing", categorySource: "match" });
    const input = { rows: stored, before: new Map(), accounts: [checking], rules: [], oldRules: [], industries: new Map(), outsideMatches: [] };
    expect(enrichIsland({ ...input, today })).toEqual({ ok: true, changed: [] });
    // without the day the island reads the lessor's rows alone: it would not pair the refund, so it hands over to the full run
    expect(enrichIsland(input)).toMatchObject({ ok: false });
  });

  it("a gym that skips a month is not ended at day 52, and is when no payment came for one and a half cadences past the expected day", () => {
    const rows = series("2025-10-05", 30.44, 11, -3490, { merchant: "ESIMERKKI KUNTOSALI OY", counterparty: "ESIMERKKI KUNTOSALI OY", category: "fitness" });
    const last = rows[rows.length - 1]!.bookingDate;
    const at = (days: number) => createContext(rows, [checking], addDays(last, days)).recurring.find((r) => r.merchant === "ESIMERKKI KUNTOSALI OY")!.contract!;
    expect(at(52)).toMatchObject({ ended: false, endedOn: null });
    expect(at(70).ended).toBe(false);
    expect(at(80)).toMatchObject({ ended: true });
  });

  it("a loan refinanced to a lower instalment has no first payment, and the earlier instalments are no first payment", () => {
    const B = { merchant: "Esimerkkipankki", counterparty: "ESIMERKKIPANKKI OYJ", category: "loans" };
    const rows = [...series("2024-01-20", 30.44, 20, -90000, B), ...series("2025-09-20", 30.44, 13, -55000, B)];
    const found = createContext(rows, [checking], today).recurring.filter((r) => r.merchant === "Esimerkkipankki" && r.contract);
    const now = found.find((r) => r.typicalAmountCents === 55000)!;
    expect(now.contract!.firstPaymentCents).toBeNull();
    // the earlier instalments are not taken for a first payment: the start is where the series begins
    expect(now.contract!.startDate).toBe(now.firstDate);
  });

  it("a loan's closing refund is paired in the pipeline too, with the category of the loan", () => {
    const B = { merchant: "Esimerkkipankki", counterparty: "ESIMERKKIPANKKI OYJ" };
    const loan = series("2024-01-20", 30.44, 12, -90000, { category: "loans", categorySource: "user", ...B });
    const back = tx({ bookingDate: "2025-02-10", amountCents: 50000, category: "income", categorySource: "default", ...B });
    const rows = [...loan, back, dayRow(today)];
    const done = new Map(enrichTransactions(rows, [checking], []).map((t) => [t.id, t]));
    expect(done.get(back.id)).toMatchObject({ category: "loans", categorySource: "match" });
  });

  it("does not net money from the payee that comes too late, is more than the contract cost, or comes while payments go on", () => {
    const base = totals(contextOf(lease()));
    expect(totals(contextOf([...lease(), refund(1800, "2026-03-20")]))).toEqual({ leasing: base.leasing, income: base.income + 180000 });
    expect(totals(contextOf([...lease(), refund(13000)]))).toEqual({ leasing: base.leasing, income: base.income + 1300000 });
    const going = [...lease(), refund(1800, "2025-06-01")];
    expect(totals(contextOf(going)).income).toBe(base.income + 180000);
  });

  it("shows the refund of a lease that is read today only once it has ended", () => {
    const early = contextOf([...lease(), refund(1800)], [], "2026-02-20").recurring.find((r) => r.merchant === LESSOR.merchant)!;
    expect(early.contract).toMatchObject({ ended: false, endedOn: null, refund: null });
    // without a refund the cost is what was paid
    const bare = contextOf(lease()).recurring.find((r) => r.merchant === LESSOR.merchant)!.contract!;
    expect(bare.costAfterRefundCents).toBe(bare.totalPaidCents);
  });

  it("an ended contract is no coming payment and a payment again makes it active again", () => {
    const gym = (n: number, from: string) =>
      series(from, 30.44, n, -3490, { merchant: "ESIMERKKI KUNTOSALI OY", counterparty: "ESIMERKKI KUNTOSALI OY", category: "fitness" });
    const stopped = createContext(gym(8, "2025-09-01"), [checking], today);
    const s = stopped.recurring.find((r) => r.merchant === "ESIMERKKI KUNTOSALI OY")!;
    expect(s.contract).toMatchObject({ ended: true, startDate: "2025-09-01", refund: null });
    expect(expectedCharges(stopped.recurring, today, addDays(today, 60))).toEqual([]);
    const ahead = cashAhead(stopped, [], NO_INPUTS);
    expect(ahead.upcoming.filter((r) => r.name.includes("KUNTOSALI"))).toEqual([]);
    expect(isContract(s)).toBe(false);

    const again = createContext([...gym(8, "2025-09-01"), ...gym(3, "2026-08-01")], [checking], today);
    const live = again.recurring.filter((r) => r.merchant === "ESIMERKKI KUNTOSALI OY" && r.active);
    expect(live).toHaveLength(1);
    expect(live[0]!.contract).toMatchObject({ ended: false, endedOn: null });
    expect(expectedCharges(again.recurring, today, addDays(today, 60)).map((c) => c.merchant)).toContain("ESIMERKKI KUNTOSALI OY");
  });

  it("a phone bill with a varying amount is a contract, groceries and rent to a person are not", () => {
    const gaps = [0, 3, 5, 6, 9, 14, 17, 22, 28, 31, 37, 41, 46, 52, 55, 61, 66, 70, 74, 80, 85];
    const amounts = [-4120, -3980, -4450, -3890, -4230, -4010];
    const rows = [
      ...series("2026-04-10", 30.44, 6, (i) => amounts[i]!, { merchant: "ESIMERKKI TELE OYJ", counterparty: "ESIMERKKI TELE OYJ", category: "phone" }),
      ...series("2026-04-01", 30.44, 6, -90000, { merchant: "Matti Meikalainen", counterparty: "Matti Meikalainen", category: "housing" }),
      ...series("2026-04-03", 30.44, 6, -5000, { merchant: "Siirto", counterparty: "Siirto", category: "other" }),
      ...gaps.map((g, i) => tx({ bookingDate: addDays("2026-07-12", g), amountCents: -(1800 + (i % 5) * 450), merchant: "ESIMERKKI MARKET OY", counterparty: "ESIMERKKI MARKET OY", category: "groceries" })),
    ];
    const found = createContext(rows, [checking], today).recurring;
    expect(found.find((s) => s.merchant === "ESIMERKKI TELE OYJ")).toMatchObject({ kind: "bill", contract: { ended: false, firstPaymentCents: null, startDate: "2026-04-10" } });
    expect(found.find((s) => s.merchant === "Matti Meikalainen")?.contract).toBeUndefined();
    // a name that does not say whether it is a company or a person is no contract
    expect(found.find((s) => s.merchant === "Siirto")).toMatchObject({ kind: "subscription" });
    expect(found.find((s) => s.merchant === "Siirto")?.contract).toBeUndefined();
    const market = found.find((s) => s.merchant === "ESIMERKKI MARKET OY");
    expect(market?.kind).toBe("habit");
    expect(market?.contract).toBeUndefined();
  });

  it("a loan from a bank whose name says it is one, or says nothing, is a contract; a person's name is not", () => {
    const loan = (merchant: string, counterparty: string, category = "loans") => series("2026-01-03", 30.44, 9, -32500, { merchant, counterparty, category });
    const contractOf = (rows: Transaction[]) => createContext(rows, [checking], today).recurring[0]!.contract;
    expect(contractOf(loan("Nordea", "NORDEA BANK ABP"))).toBeDefined();
    expect(contractOf(loan("Danske Bank", "DANSKE BANK"))).toBeDefined();
    // a name that does not say: a company for leasing and insurance only, a loan from a relative is none
    expect(contractOf(loan("Esimerkki", "ESIMERKKI", "leasing"))).toBeDefined();
    expect(contractOf(loan("Esimerkki", "ESIMERKKI", "insurance"))).toBeDefined();
    expect(contractOf(loan("Esimerkki", "ESIMERKKI"))).toBeUndefined();
    expect(contractOf(loan("Mummo", "Mummo"))).toBeUndefined();
    expect(contractOf(loan("Siirto", "Siirto"))).toBeUndefined();
    expect(contractOf(loan("Esimerkki", "ESIMERKKI", "groceries"))).toBeUndefined();
    expect(contractOf(loan("Matti Pankkinen", "MATTI PANKKINEN"))).toBeUndefined();
  });

  it("a loan is a contract with a monthly cost: the bank's name has lost its legal form, the counterparty has it", () => {
    const loan = (counterparty: string) => series("2026-01-03", 30.44, 9, -32500, { merchant: "Esimerkkipankki", counterparty, category: "loans" });
    const found = createContext(loan("ESIMERKKIPANKKI OYJ"), [checking], today).recurring[0]!;
    expect(found.contract).toMatchObject({ startDate: "2026-01-03", monthlyCents: 32500, ended: false, firstPaymentCents: null });
    expect(isContract(found)).toBe(true);
  });

  it("two payments are no contract", () => {
    const two = series("2026-07-10", 30.44, 2, -3490, { merchant: "ESIMERKKI KUNTOSALI OY", category: "fitness" });
    expect(createContext(two, [checking], today).recurring.filter((s) => s.contract)).toEqual([]);
  });

  it("the user's mark wins over the inference", () => {
    const ctx = contextOf([...lease(), refund(1800)]);
    const s = ctx.recurring.find((r) => r.merchant === LESSOR.merchant)!;
    const mark = (kind: UserMark["mark"], at: string): ReadonlyMap<string, UserMark> => marksBySubject([{ subject: seriesMarkSubject(s), mark: kind, markedAt: `${at}T08:00:00` }]);
    expect(isEndedContract(s, new Map(), today)).toBe(true);
    // said in use within the year: it did not end
    expect(isEndedContract(s, mark("in_use", "2026-09-01"), today)).toBe(false);
    expect(isEndedContract(s, mark("cancelled", "2026-09-01"), today)).toBe(true);
    // a contract still paying that the user cancelled has ended
    const live = createContext(series("2026-05-10", 30.44, 5, -2990, { merchant: "ESIMERKKI TELE OYJ", category: "phone" }), [checking], today).recurring[0]!;
    expect(isEndedContract(live, new Map(), today)).toBe(false);
    expect(isEndedContract(live, marksBySubject([{ subject: seriesMarkSubject(live), mark: "cancelled", markedAt: "2026-09-20T08:00:00" }]), today)).toBe(true);
  });
});
