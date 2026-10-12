/**
 * The block Asuminen of the first page (`housing.ts`): the home loans with their terms, then the rent and the charges.
 * It owns no figure, so the tests hold it to the owners: the loans of Varallisuus > Lainat, the plan's next payment
 * and the series' own month. Made-up payees and sums only.
 */
import { describe, expect, it } from "vitest";
import { applyUse } from "../src/account-use.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { loanProposals } from "../src/loan-detect.ts";
import { loanNextPayment } from "../src/loans.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, BalanceInput, Loan, Part, Transaction, UserInputs, UserMark } from "../src/types.ts";
import { ACCOUNTS, randomHistory } from "./gen.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const range = { from: "2026-06-01", to: today };
const checking: BalanceInput = { id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: 250_000, ownerName: null, balanceAt: null };
const accountOf = (b: BalanceInput): Account => ({ id: b.id, name: b.name, iban: null, currency: "EUR", type: b.type });

const loan = (p: Partial<Loan> & Pick<Loan, "id">): Loan => ({
  name: "Asuntolaina", lender: "ESIMERKKIPANKKI", kind: "mortgage", grantedCents: null, balanceCents: 14_823_055, balanceDate: "2026-09-15", rateBp: 310, reference: "euribor_12", marginBp: 65,
  repayment: "annuity", intervalMonths: 1, paymentCents: 91_240, endDate: null, limitCents: null, seriesKey: null, ...p,
});

/** A payment on the same day of each month from May to October. */
const monthly = (merchant: string, cents: number, day: string, more: Partial<Transaction> = {}): Transaction[] =>
  ["05", "06", "07", "08", "09", "10"].map((month) => tx({ bookingDate: `2026-${month}-${day}`, amountCents: -cents, merchant, counterparty: merchant, category: "housing", ...more }));
const instalments = (cents = 91_240, payee = "ESIMERKKIPANKKI") => monthly(payee, cents, "02", { category: "mortgage", description: "Lainan lyhennys" });
const answer: UserMark = { subject: "question:mortgage", mark: "dismissed", markedAt: "2026-10-01T08:00:00.000Z" };

/** The first page of a household with the rows, loans and marks given. */
function page(rows: readonly Transaction[], loans: Loan[] = [], marks: UserMark[] = [], balances: BalanceInput[] = [checking]) {
  const ctx = createContext([...rows], balances.map(accountOf), today);
  const inputs: UserInputs = { marks, expectedBills: [], loans };
  const dashboard = buildDashboard(ctx, range, balances, inputs);
  return { ctx, inputs, housing: dashboard.housing, holdings: dashboard.holdings };
}
const monthOf = (ctx: ReturnType<typeof page>["ctx"], merchant: string) => ctx.recurring.filter((s) => s.merchant === merchant).map((s) => s.monthlyCents);

describe("the home loans of Asuminen", () => {
  it("a home loan has its month, its next payment with the due date and the parts of its rate", () => {
    // the last due date is typed, so the plan's days are the bank's
    const home = loan({ id: "home", rateReviewDate: "2027-03-15", endDate: "2046-09-15" });
    const { housing, holdings } = page([], [home]);
    expect(housing).toEqual({
      loans: [
        {
          id: "home", name: "Asuntolaina", lender: "ESIMERKKIPANKKI", seriesId: null, monthlyCents: 91_240,
          next: { cents: 91_240, interestCents: 38_293, amortisationCents: 52_947, intervalMonths: 1, unknown: null, date: "2026-10-15" },
          rateBp: 310, reference: "euribor_12", marginBp: 65, referenceBp: 245, reviewDate: "2027-03-15", reviewPassed: false, typedByOther: false,
        },
      ],
      charges: [],
      loansMonthlyCents: 91_240,
      chargesMonthlyCents: 0,
      totalMonthlyCents: 91_240,
      partial: false,
      atPart: false,
      ask: false,
    });
    // the figures are the owners': the plan's payment and the month of Varallisuus > Lainat
    expect(housing!.loans[0]!.next).toEqual(loanNextPayment(home, today));
    expect(holdings.loans.map((row) => [row.id, row.monthlyPaymentCents])).toEqual([["home", 91_240]]);
  });

  it("the reference rate is told only when the rate, the margin and a reference rate are, and the review day says when it has passed", () => {
    const loans = [
      loan({ id: "ahead", rateReviewDate: "2026-10-10" }),
      loan({ id: "today", rateReviewDate: today }),
      loan({ id: "passed", rateReviewDate: "2026-03-15" }),
      loan({ id: "no-day" }),
      loan({ id: "fixed", reference: "fixed", rateReviewDate: "2027-03-15" }),
      loan({ id: "no-reference", reference: null, rateReviewDate: "2027-03-15" }),
      loan({ id: "at-margin", rateBp: 65 }),
      loan({ id: "under-margin", rateBp: 64 }),
      loan({ id: "no-margin", marginBp: null }),
      loan({ id: "no-rate", rateBp: null }),
    ];
    const terms = Object.fromEntries(page([], loans).housing!.loans.map((row) => [row.id, [row.referenceBp, row.reviewDate, row.reviewPassed]]));
    expect(terms).toEqual({
      ahead: [245, "2026-10-10", false],
      today: [245, today, true],
      passed: [245, "2026-03-15", true],
      "no-day": [245, null, false],
      // a fixed rate is not set again: neither a reference rate nor a day
      fixed: [null, null, false],
      "no-reference": [null, "2027-03-15", false],
      "at-margin": [0, null, false],
      "under-margin": [null, null, false],
      "no-margin": [null, null, false],
      "no-rate": [null, null, false],
    });
  });

  it("only a home loan that is still owed is a row, and a loan that tells no payment leaves the total partial", () => {
    const { housing } = page([], [loan({ id: "other", kind: "consumer" }), loan({ id: "paid", balanceCents: 0 }), loan({ id: "open", repayment: null, intervalMonths: null, paymentCents: null }), loan({ id: "home" })]);
    expect(Object.fromEntries(housing!.loans.map((row) => [row.id, row.monthlyCents]))).toEqual({ open: null, home: 91_240 });
    expect(housing).toMatchObject({ totalMonthlyCents: 91_240, partial: true, ask: false });
    // a home loan paid off is no row, and nothing is asked of a household that saved one
    expect(page([], [loan({ id: "paid", balanceCents: 0 })]).housing).toBeNull();
  });

  it("loan payments with no saved loan are a row without terms, and a saved loan linked to them is the one row", () => {
    const rows = instalments();
    const { ctx, housing } = page(rows);
    const series = ctx.recurring.find((s) => s.category === "mortgage")!;
    expect(housing!.loans).toEqual([
      { id: null, name: null, lender: "ESIMERKKIPANKKI", seriesId: series.id, monthlyCents: series.monthlyCents, next: null, rateBp: null, reference: null, marginBp: null, referenceBp: null, reviewDate: null, reviewPassed: false, typedByOther: false },
    ]);
    expect(housing).toMatchObject({ totalMonthlyCents: series.monthlyCents, partial: false, ask: false });
    expect(series.monthlyCents).toBeGreaterThan(0);

    const proposals = loanProposals(ctx, { marks: [], expectedBills: [], loans: [] });
    expect(proposals.map((p) => p.seriesId)).toEqual([series.id]);
    const linked = page(rows, [loan({ id: "home", seriesKey: proposals[0]!.key })]);
    expect(linked.housing!.loans.map((row) => [row.id, row.seriesId, row.monthlyCents])).toEqual([["home", null, 91_240]]);
    expect(linked.housing!.totalMonthlyCents).toBe(91_240);
    expect(loanProposals(linked.ctx, linked.inputs)).toEqual([]);

    // "Ei laina" of the proposal: the payments are no home loan
    const refused = page(rows, [], [{ subject: `loan-proposal:${proposals[0]!.key}`, mark: "dismissed", markedAt: "2026-10-01T08:00:00.000Z" }]);
    expect(refused.housing).toMatchObject({ loans: [], ask: true });
  });

  it("a home loan typed by hand takes the payments that fit its payment, so the payment is in the total once", () => {
    const typed = loan({ id: "home" });
    const one = page(instalments(), [typed]);
    expect(one.housing!.loans.map((row) => row.id)).toEqual(["home"]);
    expect(one.housing!.totalMonthlyCents).toBe(91_240);

    // a second loan's payments stay a row of their own
    const two = page([...instalments(), ...monthly("TOINEN PANKKI", 30_000, "20", { category: "mortgage", description: "Lainan lyhennys" })], [typed]);
    expect(two.housing!.loans.map((row) => [row.id, row.lender])).toEqual([["home", "ESIMERKKIPANKKI"], [null, "TOINEN PANKKI"]]);
    expect(two.housing!.totalMonthlyCents).toBe(91_240 + monthOf(two.ctx, "TOINEN PANKKI")[0]!);
  });

  const other = monthly("TOINEN PANKKI", 30_000, "20", { category: "mortgage", description: "Lainan lyhennys" });
  const shown = (housing: NonNullable<ReturnType<typeof page>["housing"]>) => housing.loans.map((row) => [row.id, row.lender, row.monthlyCents]);

  it("a loan with a payment typed takes a series only where its charges fit the payment, within the tolerance of a link", () => {
    // its payments leave an account outside the view: the other bank's payments are a second loan
    const outside = page(other, [loan({ id: "home" })]);
    expect(shown(outside.housing!)).toEqual([["home", "ESIMERKKIPANKKI", 91_240], [null, "TOINEN PANKKI", monthOf(outside.ctx, "TOINEN PANKKI")[0]!]]);
    expect(outside.housing!.totalMonthlyCents).toBe(91_240 + monthOf(outside.ctx, "TOINEN PANKKI")[0]!);
    // 91 240 and a tenth of it, 9 124, either side: 100 000 fits, 101 000 does not
    expect(page(instalments(100_000), [loan({ id: "home" })]).housing!.loans.map((row) => row.id)).toEqual(["home"]);
    expect(page(instalments(101_000), [loan({ id: "home" })]).housing!.loans.map((row) => row.id)).toEqual(["home", null]);
    expect(page(instalments(83_000), [loan({ id: "home" })]).housing!.loans.map((row) => row.id)).toEqual(["home"]);
    expect(page(instalments(82_000), [loan({ id: "home" })]).housing!.loans.map((row) => row.id)).toEqual(["home", null]);
  });

  it("a loan linked to payments takes none, also when they are of another category than a mortgage", () => {
    const rahoitus = monthly("ESIMERKKIRAHOITUS OY", 91_240, "02", { category: "loans", description: "Lainan lyhennys" });
    const first = page(rahoitus);
    const linked = page([...rahoitus, ...other], [loan({ id: "home", seriesKey: loanProposals(first.ctx, first.inputs)[0]!.key })]);
    expect(shown(linked.housing!)).toEqual([["home", "ESIMERKKIPANKKI", 91_240], [null, "TOINEN PANKKI", monthOf(linked.ctx, "TOINEN PANKKI")[0]!]]);
    expect(linked.housing!.totalMonthlyCents).toBe(91_240 + monthOf(linked.ctx, "TOINEN PANKKI")[0]!);
    // a key that names no series today still makes the loan a linked one
    expect(page(other, [loan({ id: "home", seriesKey: "out:acc-1:ESIMERKKIRAHOITUS OY" })]).housing!.loans.map((row) => row.id)).toEqual(["home", null]);
  });

  it("a loan that tells no payment takes the one series that is free, and none where two are or where it is not the only such loan", () => {
    const bare = loan({ id: "home", repayment: null, intervalMonths: null, paymentCents: null });
    const one = page(instalments(), [bare]);
    expect(monthOf(one.ctx, "ESIMERKKIPANKKI")).toEqual([91_240]);
    expect(shown(one.housing!)).toEqual([["home", "ESIMERKKIPANKKI", 91_240]]);
    expect(one.housing).toMatchObject({ totalMonthlyCents: 91_240, partial: false });

    const two = page([...instalments(), ...other], [bare]);
    const months = monthOf(two.ctx, "TOINEN PANKKI")[0]!;
    expect(shown(two.housing!)).toEqual([["home", "ESIMERKKIPANKKI", null], [null, "ESIMERKKIPANKKI", 91_240], [null, "TOINEN PANKKI", months]]);
    expect(two.housing).toMatchObject({ totalMonthlyCents: 91_240 + months, partial: true });

    // two loans with no payment and one series: neither is told from the other, so the series stays a row of its own
    const both = page(instalments(), [bare, loan({ ...bare, id: "second" })]);
    expect(shown(both.housing!)).toEqual([["home", "ESIMERKKIPANKKI", null], ["second", "ESIMERKKIPANKKI", null], [null, "ESIMERKKIPANKKI", 91_240]]);
    // a loan with a payment typed takes its series first, and the loan with none finds nothing free
    const typed = page(instalments(), [bare, loan({ id: "typed" })]);
    expect(shown(typed.housing!)).toEqual([["home", "ESIMERKKIPANKKI", null], ["typed", "ESIMERKKIPANKKI", 91_240]]);
  });

  it("a loan that takes payments paid from a shared account is cut as they are, and the members' parts add up to the household's", () => {
    const joint: BalanceInput = { ...checking, id: "joint", name: "Yhteinen tili" };
    const rows = monthly("ESIMERKKIPANKKI", 91_240, "02", { accountId: "joint", category: "mortgage", description: "Lainan lyhennys" });
    const typed = loan({ id: "home" });
    const mine: Part = { from: 0, to: 3, of: 5 };
    const his: Part = { from: 3, to: 5, of: 5 };
    const view = (part: Part | null, loans: Loan[]) => page(part ? applyUse(rows, [accountOf(joint)], new Map([["joint", part]])) : rows, loans, [], [part ? { ...joint, part } : joint]);

    const household = view(null, [typed]);
    expect(shown(household.housing!)).toEqual([["home", "ESIMERKKIPANKKI", 91_240]]);
    expect(household.housing).toMatchObject({ totalMonthlyCents: 91_240, atPart: false });

    const own = view(mine, [typed]);
    expect(shown(own.housing!)).toEqual([["home", "ESIMERKKIPANKKI", 54_744]]);
    expect(own.housing!.loans[0]!.next).toMatchObject({ cents: loanNextPayment({ ...typed, part: mine }, today).cents, date: own.ctx.recurring[0]!.nextDate });
    expect(own.housing).toMatchObject({ totalMonthlyCents: 54_744, atPart: true });

    // the partner typed nothing: the payments are a row without terms, at his part
    const partner = view(his, []);
    expect(shown(partner.housing!)).toEqual([[null, "ESIMERKKIPANKKI", 36_496]]);
    expect(own.housing!.totalMonthlyCents + partner.housing!.totalMonthlyCents).toBe(household.housing!.totalMonthlyCents);
    // near miss: the payments leave an account that is the viewer's whole, so the row is whole and says no part
    expect(page(instalments(), [typed], [], [checking, { ...joint, part: mine }]).housing).toMatchObject({ totalMonthlyCents: 91_240, atPart: false });
    // each row says whose part it holds: the loan that takes the payments, the payments with no loan, and no part on a whole row
    expect(own.housing!.loans[0]!.part).toEqual(mine);
    expect(partner.housing!.loans[0]!.part).toEqual(his);
    expect(household.housing!.loans[0]).not.toHaveProperty("part");
  });

  it("a loan another member typed in says so in the member's own view and in the household's, and the viewer's own does not", () => {
    const joint: BalanceInput = { ...checking, id: "joint", name: "Yhteinen tili" };
    const rows = monthly("ESIMERKKIPANKKI", 91_240, "02", { accountId: "joint", category: "mortgage", description: "Lainan lyhennys" });
    const mine: Part = { from: 0, to: 3, of: 5 };
    const flags = (loans: Loan[], part: Part | null) =>
      page(part ? applyUse(rows, [accountOf(joint)], new Map([["joint", part]])) : rows, loans, [], [part ? { ...joint, part } : joint]).housing!.loans.map((row) => [row.id, row.typedByOther]);
    // the server names the typist on a loan a view holds for another member (`Loan.typedBy`)
    const partners = loan({ id: "home", typedBy: "Eero" });
    expect(flags([partners], mine)).toEqual([["home", true]]);
    expect(flags([partners], null)).toEqual([["home", true]]);
    // near miss: the viewer's own loan, in both views, and payments with no saved loan
    expect(flags([loan({ id: "home" })], mine)).toEqual([["home", false]]);
    expect(flags([loan({ id: "home" })], null)).toEqual([["home", false]]);
    expect(flags([], mine)).toEqual([[null, false]]);
  });

  it("a refund from the lender and money in change no figure of the block", () => {
    const refund = tx({ bookingDate: "2026-08-20", amountCents: 12_000, merchant: "ESIMERKKIPANKKI", counterparty: "ESIMERKKIPANKKI", category: "mortgage", description: "Koronpalautus" });
    const pay = tx({ bookingDate: "2026-10-01", amountCents: 320_000, merchant: "ESIMERKKITYONANTAJA OY", counterparty: "ESIMERKKITYONANTAJA OY", category: "salary", description: "Palkka" });
    const plain = page(instalments(), [loan({ id: "home" })]).housing;
    expect(page([...instalments(), refund, pay], [loan({ id: "home" })]).housing).toEqual(plain);
    expect(page([...instalments(), refund, pay]).housing!.loans.map((row) => [row.id, row.monthlyCents])).toEqual([[null, 91_240]]);
  });

  it("the next payment's day is the plan's where the last due date is typed, else the day the payments leave, else none", () => {
    const rows = instalments();
    const first = page(rows);
    const series = first.ctx.recurring.find((s) => s.category === "mortgage")!;
    const key = loanProposals(first.ctx, first.inputs)[0]!.key;
    expect(series.nextDate).toBe("2026-11-02");
    const day = (loans: Loan[], more: Transaction[] = rows) => page(more, loans).housing!.loans[0]!.next!.date;
    // the balance was typed on the 15th and the payments leave on the 2nd
    expect(day([loan({ id: "home", seriesKey: key })])).toBe("2026-11-02");
    expect(day([loan({ id: "home" })])).toBe("2026-11-02");
    expect(day([loan({ id: "home", seriesKey: key, endDate: "2046-09-15" })])).toBe("2026-10-15");
    // near misses: a last due date on or before the balance date anchors nothing, and no payments tell no day
    expect(day([loan({ id: "home", seriesKey: key, endDate: "2026-09-15" })])).toBe("2026-11-02");
    expect(day([loan({ id: "home" })], [])).toBeNull();
    expect(day([loan({ id: "home", endDate: "2046-09-15" })], [])).toBe("2026-10-15");
    // payments that have stopped name no day
    const stopped = ["01", "02", "03", "04", "05"].map((month) => tx({ bookingDate: `2026-${month}-02`, amountCents: -91_240, merchant: "ESIMERKKIPANKKI", counterparty: "ESIMERKKIPANKKI", category: "mortgage", description: "Lainan lyhennys" }));
    const old = page(stopped).ctx.recurring.find((s) => s.category === "mortgage")!;
    expect(old.active).toBe(false);
    expect(day([loan({ id: "home", seriesKey: old.id })], stopped)).toBeNull();
  });
});

describe("the charges of Asuminen", () => {
  const company = "AS OY ESIMERKKIKATU";

  it("each contract of the home is a row named by the words of its latest payment, the largest first", () => {
    const rows = [
      ...monthly(company, 25_000, "02", { description: "Hoitovastike" }),
      ...monthly(company, 40_000, "12", { description: "Rahoitusvastike" }),
      ...monthly("ESIMERKKI VERKKO OY", 4_500, "03", { category: "utilities", description: "Lasku" }),
      ...monthly("ESIMERKIN VESIHUOLTO", 3_000, "04", { category: "utilities", description: "Lasku" }),
      ...monthly("ESIMERKKI ISANNOINTI", 2_000, "06", { description: "Lasku" }),
      // not of the home: another category
      ...monthly("ESIMERKKI KUNTOSALI", 3_900, "07", { category: "other", description: "Jäsenmaksu" }),
    ];
    const { ctx, housing } = page(rows, [], [answer]);
    expect(housing!.charges.map((c) => [c.label, c.payee])).toEqual([
      ["Rahoitusvastike", company],
      ["Hoitovastike", company],
      ["Sähkönsiirto", "ESIMERKKI VERKKO OY"],
      ["Vesi", "ESIMERKIN VESIHUOLTO"],
      [null, "ESIMERKKI ISANNOINTI"],
    ]);
    const months = housing!.charges.map((c) => c.monthlyCents);
    expect(months).toEqual(housing!.charges.map((c) => ctx.recurring.find((s) => s.id === c.seriesId)!.monthlyCents));
    expect(months[1]).toBe(25_000);
    expect(housing).toMatchObject({ loans: [], totalMonthlyCents: months.reduce((sum, cents) => sum + cents, 0), partial: false, atPart: false, ask: false });
  });

  it("two payments to one payee on one day are one charge, named by the payee where their words differ", () => {
    const { housing } = page([...monthly(company, 25_000, "02", { description: "Hoitovastike" }), ...monthly(company, 40_000, "02", { description: "Rahoitusvastike" })]);
    expect(housing!.charges.map((c) => [c.label, c.payee, c.monthlyCents])).toEqual([["Vastike", company, 65_000]]);
  });

  it("a payment that bills the rent is the rent, whatever water or car place it names, and a tenant is not asked", () => {
    const paid = (text: string, payee = "MATTI MEIKALAINEN") => page(monthly(payee, 85_000, "02", { description: text })).housing!;
    expect(paid("Vuokra ja vesimaksu")).toMatchObject({ charges: [{ label: "Vuokra", monthlyCents: 85_000 }], ask: false });
    expect(paid("Vuokra ja autopaikka")).toMatchObject({ charges: [{ label: "Vuokra" }], ask: false });
    expect(paid("Vuokra + vesi", "SATO OYJ")).toMatchObject({ charges: [{ label: "Vuokra" }], ask: false });
    // near misses: water or a car place alone is that charge, and it is no rent, so the question stays
    expect(paid("Vesimaksu")).toMatchObject({ charges: [{ label: "Vesimaksu" }], ask: true });
    expect(paid("Autopaikka")).toMatchObject({ charges: [{ label: "Autopaikka" }], ask: true });
    // a vastike with water in it is the vastike
    expect(paid("Yhtiövastike ja vesimaksu", "AS OY ESIMERKKIKATU")).toMatchObject({ charges: [{ label: "Vastike" }], ask: true });
    expect(paid("Vesimaksu", "AS OY ESIMERKKIKATU")).toMatchObject({ charges: [{ label: "Vesimaksu" }] });
  });

  it("asks of a home loan only where none is saved or paid, no rent is paid and the member has not answered", () => {
    const charge = monthly(company, 25_000, "02", { description: "Hoitovastike" });
    expect(page(charge).housing).toMatchObject({ loans: [], ask: true });
    expect(page(charge, [], [answer]).housing).toMatchObject({ charges: [{ label: "Hoitovastike" }], ask: false });
    expect(page([...charge, ...instalments()]).housing!.ask).toBe(false);
    expect(page(charge, [loan({ id: "home" })]).housing!.ask).toBe(false);
    // another loan is no home loan
    expect(page(charge, [loan({ id: "other", kind: "consumer" })]).housing!.ask).toBe(true);
    // a tenant has none to add
    const rent = monthly("ESIMERKIN ASUNNOT OY", 85_000, "02", { description: "Vuokra" });
    expect(page(rent).housing).toMatchObject({ charges: [{ label: "Vuokra", monthlyCents: 85_000 }], ask: false });
    expect(page(monthly("ESIMERKIN ASUMISOIKEUS OY", 70_000, "02", { description: "Käyttövastike" })).housing).toMatchObject({ charges: [{ label: "Käyttövastike" }], ask: false });
  });

  it("a view with nothing of a home is the question alone, and null once it is answered", () => {
    expect(page([]).housing).toEqual({ loans: [], charges: [], loansMonthlyCents: 0, chargesMonthlyCents: 0, totalMonthlyCents: 0, partial: false, atPart: false, ask: true });
    expect(page([], [], [answer]).housing).toBeNull();
    expect(page(monthly("ESIMERKKI KUNTOSALI", 3_900, "07", { category: "other" }), [], [answer]).housing).toBeNull();
  });

  it("a member's own view has the viewer's part of a charge from a joint account, and says so", () => {
    const part = { from: 0, to: 3, of: 5 };
    const joint: BalanceInput = { ...checking, id: "joint", name: "Yhteinen tili" };
    const whole = monthly(company, 50_000, "02", { accountId: "joint", description: "Hoitovastike" });
    expect(page(whole, [], [answer], [joint]).housing).toMatchObject({ charges: [{ label: "Hoitovastike", monthlyCents: 50_000 }], totalMonthlyCents: 50_000, atPart: false });
    const own = page(applyUse(whole, [accountOf(joint)], new Map([["joint", part]])), [], [answer], [{ ...joint, part }]);
    expect(own.housing).toMatchObject({ charges: [{ label: "Hoitovastike", monthlyCents: 30_000, part }], totalMonthlyCents: 30_000, atPart: true });
    // the whole account's row carries no part
    expect(page(whole, [], [answer], [joint]).housing!.charges[0]).not.toHaveProperty("part");
  });
});

describe("Asuminen against the first page's holdings", () => {
  it("on every seeded household the saved home loans are the rows of Varallisuus > Lainat, and each row is in the total once", () => {
    const problems: string[] = [];
    let rows = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { txs, accounts, rules } = randomHistory(seed, 250);
      const on = "2025-11-15";
      const ctx = createContext(enrichTransactions(txs, accounts, rules), accounts, on);
      const balances = ACCOUNTS.map((a): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents: a.type === "loan" ? -9_000_000 : 100_000, ownerName: null, balanceAt: null }));
      const saved = [
        loan({ id: `home-${seed}`, balanceDate: "2025-10-01", balanceCents: 9_000_000 + seed * 1_000 }),
        loan({ id: `paid-${seed}`, balanceDate: "2025-10-01", balanceCents: 0 }),
        loan({ id: `car-${seed}`, balanceDate: "2025-10-01", kind: "consumer", balanceCents: 800_000, paymentCents: 20_000 }),
        ...(seed % 2 ? [loan({ id: `open-${seed}`, balanceDate: "2025-10-01", repayment: null, intervalMonths: null, paymentCents: null })] : []),
      ];
      const inputs: UserInputs = { marks: [], expectedBills: [], loans: saved };
      const { housing, holdings } = buildDashboard(ctx, { from: "2025-10-01", to: on }, balances, inputs);
      if (!housing) {
        problems.push(`${seed}: no block`);
        continue;
      }
      const held = holdings.loans.filter((row) => row.kind === "mortgage" && row.leftCents !== 0).map((row) => [row.id, row.monthlyPaymentCents]);
      const own = housing.loans.filter((row) => row.id !== null).map((row) => [row.id, row.monthlyCents]);
      if (JSON.stringify(own) !== JSON.stringify(held)) problems.push(`${seed}: loans ${JSON.stringify(own)} against ${JSON.stringify(held)}`);
      const days = new Set(ctx.recurring.map((s) => s.nextDate));
      for (const row of housing.loans) {
        const typed = saved.find((l) => l.id === row.id);
        // no last due date is typed: the plan's split and sum are the owner's, and the day is a series' or none
        if (typed && JSON.stringify({ ...row.next, date: null }) !== JSON.stringify({ ...loanNextPayment(typed, on), date: null })) problems.push(`${seed}: the next payment of ${row.id}`);
        if (typed && row.next?.date != null && !days.has(row.next.date)) problems.push(`${seed}: the day of the next payment of ${row.id}`);
      }
      const series = [...housing.loans.map((row) => row.seriesId), ...housing.charges.map((c) => c.seriesId)].filter((id) => id !== null);
      if (new Set(series).size !== series.length) problems.push(`${seed}: a series twice`);
      for (const c of housing.charges) {
        const s = ctx.recurring.find((r) => r.id === c.seriesId);
        if (!s || (s.category !== "housing" && s.category !== "utilities") || s.monthlyCents !== c.monthlyCents) problems.push(`${seed}: the charge ${c.seriesId}`);
      }
      const sum = [...housing.loans, ...housing.charges].reduce((total, row) => total + (row.monthlyCents ?? 0), 0);
      if (housing.totalMonthlyCents !== sum) problems.push(`${seed}: the total ${housing.totalMonthlyCents} against ${sum}`);
      // the two sums are the loans' rows and the charges' rows, and nothing is in both
      const months = (of: readonly { monthlyCents: number | null }[]) => of.reduce((total, row) => total + (row.monthlyCents ?? 0), 0);
      if (housing.loansMonthlyCents !== months(housing.loans) || housing.chargesMonthlyCents !== months(housing.charges)) problems.push(`${seed}: the two sums`);
      if (housing.loansMonthlyCents + housing.chargesMonthlyCents !== housing.totalMonthlyCents) problems.push(`${seed}: the sums against the total`);
      if (housing.partial !== housing.loans.some((row) => row.monthlyCents === null)) problems.push(`${seed}: partial`);
      if (housing.ask) problems.push(`${seed}: asks with a home loan saved`);
      rows += housing.loans.length + housing.charges.length;
    }
    expect(problems).toEqual([]);
    expect(rows).toBeGreaterThan(20);
  }, 30_000);
});
