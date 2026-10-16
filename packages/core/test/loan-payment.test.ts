/**
 * Loan payment accounts and the kind of a loan (`loan-payment.ts`, `loan-detect.ts`): an account the bank types as a
 * loan that only carries the instalments, a loan the household says what it is, and the loan Asuminen then reads.
 * Made-up banks, payees and sums only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { buildHoldings } from "../src/holdings.ts";
import { buildHousing } from "../src/housing.ts";
import { loanKindSubject, loanProposals, parseLoanKindSubject } from "../src/loan-detect.ts";
import { flagLoanPayment, loanPaymentAccounts } from "../src/loan-payment.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import type { Account, BalanceInput, Loan, Part, Transaction, UserInputs, UserMark } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const range = { from: "2026-06-01", to: today };
const IBAN_CHECKING = "FI2112345600000785";
const IBAN_LOAN = "FI4250001510000023";
const IBAN_PARTNER = "FI9880001400000012";
const MONTHS = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: IBAN_CHECKING, currency: "EUR", type: "checking", bank: "Esimerkkipankki", balanceCents: 250_000 };
const loanAccount = (over: Partial<Account> = {}): Account => ({ id: "acc-2", name: "Asuntolaina", iban: IBAN_LOAN, currency: "EUR", type: "loan", bank: "Esimerkkipankki", balanceCents: -45, ...over });
const balanceOf = (a: Account, over: Partial<BalanceInput> = {}): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents: a.balanceCents ?? null, ownerName: null, balanceAt: null, ...over });
const inputs = (marks: UserMark[] = [], loans: Loan[] = []): UserInputs => ({ marks, expectedBills: [], loans });
const mark = (subject: string, mark: UserMark["mark"], markedAt = "2026-10-01T08:00:00.000Z"): UserMark => ({ subject, mark, markedAt });

const salary = MONTHS.map((m) => tx({ bookingDate: `${m}-25`, amountCents: 300_000, merchant: "ESIMERKKI OY", counterparty: "ESIMERKKI OY", category: "salary", categorySource: "rule" }));

/** The household moves the instalment to the payment account on the 5th; the bank takes it out the same day. */
function carried(cents: number, over: { payee?: string; description?: string; from?: Partial<Transaction>; in?: Partial<Transaction>; out?: Partial<Transaction>; months?: readonly string[] } = {}): Transaction[] {
  return (over.months ?? MONTHS).flatMap((m) => [
    tx({ bookingDate: `${m}-05`, amountCents: -cents, accountId: "acc-1", merchant: "Oma tili", counterparty: "Matti Meikalainen", counterpartyIban: IBAN_LOAN, ...over.from }),
    tx({ bookingDate: `${m}-05`, amountCents: cents, accountId: "acc-2", merchant: "Oma tili", counterparty: "Matti Meikalainen", counterpartyIban: IBAN_CHECKING, ...over.in }),
    tx({ bookingDate: `${m}-06`, amountCents: -cents, accountId: "acc-2", merchant: over.payee ?? "Esimerkkipankki", counterparty: (over.payee ?? "ESIMERKKIPANKKI OYJ").toUpperCase(), description: over.description ?? "Lainan lyhennys", ...over.out }),
  ]);
}

/** The instalments paid straight from checking to a lender, six of them. */
const direct = (cents: number, payee: string, description = "Lainan lyhennys", extra: Partial<Transaction> = {}): Transaction[] =>
  MONTHS.slice(-6).map((m) => tx({ bookingDate: `${m}-05`, amountCents: -cents, accountId: "acc-1", merchant: payee, counterparty: payee.toUpperCase(), description, category: "loans", categorySource: "rule", ...extra }));

function world(rows: readonly Transaction[], accounts: Account[], marks: UserMark[] = [], loans: Loan[] = [], balances: BalanceInput[] = accounts.map((a) => balanceOf(a))) {
  const ctx = createContext([...rows], accounts, today);
  const flagged = flagLoanPayment(ctx, balances);
  const input = inputs(marks, loans);
  return { ctx, input, balances: flagged, holdings: buildHoldings(ctx, flagged, input), questions: buildQuestions(ctx, range, input), housing: buildHousing(ctx, flagged, input) };
}

describe("a loan payment account (a)", () => {
  const w = world([...salary, ...carried(90_000)], [checking, loanAccount()]);

  it("is told from a loan account: near-zero balance, own transfers in, the bank's instalments out", () => {
    expect([...w.ctx.paymentAccounts]).toEqual(["acc-2"]);
  });

  it("is never counted as debt and never says Lainaa jäljellä", () => {
    expect(w.holdings.loans).toEqual([]);
    expect(w.holdings.debtCents).toBe(0);
    expect(w.holdings.accounts.find((a) => a.id === "acc-2")).toMatchObject({ loanPayment: true, type: "other", balanceCents: expect.any(Number) });
  });

  it("makes its money in own transfers, so income stays the pay, and the instalment out is the loan payment once", () => {
    const income = w.ctx.txs.reduce((s, t) => s + t.flows.income, 0);
    expect(income).toBe(12 * 300_000);
    const debt = w.ctx.txs.reduce((s, t) => s + t.flows.debt, 0);
    expect(debt).toBe(12 * 90_000);
    expect(w.ctx.txs.filter((t) => t.accountId === "acc-1" && t.amountCents < 0).every((t) => t.isTransfer && t.flows.debt === 0)).toBe(true);
    expect(w.ctx.txs.filter((t) => t.accountId === "acc-2" && t.amountCents < 0).every((t) => t.category === "loans")).toBe(true);
  });

  it("proposes its instalments as a loan the app cannot place, and asks what it is", () => {
    const proposal = loanProposals(w.ctx, w.input);
    expect(proposal).toHaveLength(1);
    expect(proposal[0]).toMatchObject({ accountId: "acc-2", paymentCents: 90_000, placed: false });
    expect(w.questions.items).toMatchObject([{ kind: "loan", payee: expect.any(String), paymentCents: 90_000 }]);
  });

  it("is not one with a balance of 2 % of the flow, with a stranger's money in, or with money out to a shop", () => {
    expect(world([...salary, ...carried(90_000)], [checking, loanAccount({ balanceCents: -230_000 })]).ctx.paymentAccounts.size).toBe(0);
    expect(world([...salary, ...carried(90_000, { in: { counterparty: "Kauppa Oy", counterpartyIban: "FI7450009420000049" } })], [checking, loanAccount()]).ctx.paymentAccounts.size).toBe(0);
    expect(world([...salary, ...carried(90_000, { payee: "Prisma", description: "Ostos", out: { category: "groceries", categorySource: "rule" } })], [checking, loanAccount()]).ctx.paymentAccounts.size).toBe(0);
    // an account typed checking is never one
    expect(world([...salary, ...carried(90_000)], [checking, loanAccount({ type: "checking" })]).ctx.paymentAccounts.size).toBe(0);
  });

  it("takes a refund of an instalment out as money back, not as a payment", () => {
    const back = tx({ bookingDate: "2026-10-07", amountCents: 90_000, accountId: "acc-2", merchant: "Esimerkkipankki", counterparty: "ESIMERKKIPANKKI OYJ", counterpartyIban: "FI5550009420000081", description: "Palautus" });
    expect(world([...salary, ...carried(90_000), back], [checking, loanAccount()]).ctx.paymentAccounts.size).toBe(0);
  });
});

describe("a real loan account (b) and a paid off loan (c)", () => {
  const interest = MONTHS.map((m) => tx({ bookingDate: `${m}-28`, amountCents: -31_000, accountId: "acc-2", merchant: "Esimerkkipankki", counterparty: "ESIMERKKIPANKKI OYJ", description: "Korko" }));
  const paidIn = MONTHS.map((m) => tx({ bookingDate: `${m}-05`, amountCents: 90_000, accountId: "acc-2", merchant: "Oma tili", counterparty: "Matti Meikalainen", counterpartyIban: IBAN_CHECKING }));

  it("with a balance that falls is a debt, as before", () => {
    const real = loanAccount({ balanceCents: -14_800_000 });
    const w = world([...salary, ...paidIn, ...interest], [checking, real]);
    expect(w.ctx.paymentAccounts.size).toBe(0);
    expect(w.holdings.loans).toMatchObject([{ id: "account:acc-2", leftCents: 14_800_000, paidOff: false }]);
    expect(w.holdings.debtCents).toBe(14_800_000);
    const earlier = world([...salary, ...paidIn, ...interest], [checking, loanAccount({ balanceCents: -14_890_000 })]);
    expect(earlier.holdings.debtCents - w.holdings.debtCents).toBe(90_000);
  });

  const home: Loan = {
    id: "home", name: "Asuntolaina", lender: "ESIMERKKIPANKKI", kind: "mortgage", grantedCents: null, balanceCents: 0, balanceDate: "2026-04-01", rateBp: null, reference: null, marginBp: null,
    repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null, accountId: "acc-2",
  };
  const early = (months: readonly string[]) => carried(90_000, { months });

  it("with nothing left and no row for three months is Maksettu, not Lainaa jäljellä 0 €", () => {
    const paid = loanAccount({ balanceCents: 0 });
    const w = world([...salary, ...early(MONTHS.slice(0, 5))], [checking, paid], [], [home]);
    expect([...w.ctx.paymentAccounts]).toEqual([]);
    expect(w.holdings.loans).toMatchObject([{ id: "home", leftCents: 0, paidOff: true }]);
  });

  it("with nothing left but a row in the last three months is not yet paid off", () => {
    const paid = loanAccount({ balanceCents: 0 });
    const w = world([...salary, ...early(MONTHS.slice(0, 5)), tx({ bookingDate: "2026-09-20", amountCents: -100, accountId: "acc-2", merchant: "Esimerkkipankki", description: "Tilinhoitomaksu" })], [checking, paid], [], [home]);
    expect(w.holdings.loans).toMatchObject([{ leftCents: 0, paidOff: false }]);
  });
});

describe("instalments to a bank's loan payee with no loan account (d)", () => {
  it("asks once what the loan is, with the payee and the monthly sum", () => {
    const w = world([...salary, ...direct(25_000, "Esimerkkipankki")], [checking]);
    expect(w.questions.items).toMatchObject([{ kind: "loan", payee: "Esimerkkipankki", paymentCents: 25_000, cents: 12 * 25_000 }]);
    expect(w.housing?.ask).toBe(true);
  });

  it("places a home owner's instalment over 400 € as a mortgage without asking, and Asuminen uses it", () => {
    const charge = MONTHS.slice(-6).map((m) => tx({ bookingDate: `${m}-03`, amountCents: -31_000, accountId: "acc-1", merchant: "As Oy Esimerkkitalo", counterparty: "AS OY ESIMERKKITALO", description: "Hoitovastike", category: "housing", categorySource: "rule" }));
    const w = world([...salary, ...charge, ...direct(65_000, "Esimerkkirahoitus")], [checking]);
    expect(loanProposals(w.ctx, w.input)[0]).toMatchObject({ kind: "mortgage", placed: true });
    expect(w.questions.items.some((q) => q.kind === "loan")).toBe(false);
    expect(w.housing?.ask).toBe(false);
    expect(w.housing?.loans).toMatchObject([{ id: null, lender: "Esimerkkirahoitus", monthlyCents: 65_000 }]);
  });

  it("asks when the instalment is 400 € or less, when rent is paid, or when no housing company charges", () => {
    const charge = (word: string, cents = 31_000, payee = "As Oy Esimerkkitalo") => MONTHS.slice(-6).map((m) => tx({ bookingDate: `${m}-03`, amountCents: -cents, accountId: "acc-1", merchant: payee, counterparty: payee.toUpperCase(), description: word, category: "housing", categorySource: "rule" }));
    const placed = (rows: Transaction[]) => {
      const w = world(rows, [checking]);
      return loanProposals(w.ctx, w.input)[0]!.placed;
    };
    expect(placed([...salary, ...charge("Hoitovastike"), ...direct(40_000, "Esimerkkipankki")])).toBe(false);
    expect(placed([...salary, ...charge("Hoitovastike"), ...direct(40_100, "Esimerkkirahoitus")])).toBe(true);
    expect(placed([...salary, ...charge("Vuokra", 60_000, "Esimerkki Vuokraus Oy"), ...direct(65_000, "Esimerkkipankki")])).toBe(false);
    expect(placed([...salary, ...direct(65_000, "Esimerkkipankki")])).toBe(false);
  });

  it("places a finance company's steady instalment without asking, and one that varies stays a question", () => {
    const w = world([...salary, ...direct(25_000, "Esimerkkirahoitus Oy")], [checking]);
    expect(loanProposals(w.ctx, w.input)[0]).toMatchObject({ kind: "consumer", placed: true });
    expect(w.questions.items.some((q) => q.kind === "loan")).toBe(false);
    const varying = MONTHS.slice(-6).map((m, i) => tx({ bookingDate: `${m}-05`, amountCents: -[25_000, 9_000, 31_000, 14_000, 40_000, 21_000][i]!, accountId: "acc-1", merchant: "Esimerkkirahoitus Oy", counterparty: "ESIMERKKIRAHOITUS OY", description: "Lainan lyhennys", category: "loans", categorySource: "rule" }));
    expect(loanProposals(world([...salary, ...varying], [checking]).ctx, inputs())[0]?.placed ?? false).toBe(false);
  });

  it("places a car financer's instalment as Autolaina without asking", () => {
    const w = world([...salary, ...direct(41_200, "Toyota Finance Finland Oy", "AUTORAHOITUS 44512")], [checking]);
    expect(loanProposals(w.ctx, w.input)[0]).toMatchObject({ kind: "car", placed: true });
    expect(w.questions.items.some((q) => q.kind === "loan")).toBe(false);
  });

  it("makes Asuminen use the answer Asuntolaina, and a refund of an instalment moves nothing", () => {
    const rows = [...salary, ...direct(25_000, "Esimerkkirahoitus")];
    const key = loanProposals(createContext(rows, [checking], today), inputs())[0]!.key;
    const told = [mark(loanKindSubject("mortgage", key), "in_use")];
    const refund = tx({ bookingDate: "2026-10-07", amountCents: 25_000, accountId: "acc-1", merchant: "Esimerkkirahoitus", counterparty: "ESIMERKKIRAHOITUS", description: "Palautus" });
    for (const more of [[], [refund]]) {
      const w = world([...rows, ...more], [checking], told);
      expect(w.housing).toMatchObject({ ask: false, loans: [{ lender: "Esimerkkirahoitus", monthlyCents: 25_000 }] });
      expect(w.questions.items.some((q) => q.kind === "loan")).toBe(false);
    }
  });

  it("keeps an answer other than Asuntolaina out of Asuminen", () => {
    const rows = [...salary, ...direct(25_000, "Esimerkkirahoitus")];
    const key = loanProposals(createContext(rows, [checking], today), inputs())[0]!.key;
    const w = world(rows, [checking], [mark(loanKindSubject("consumer", key), "in_use")]);
    expect(loanProposals(w.ctx, w.input)[0]).toMatchObject({ kind: "consumer", placed: true });
    expect(w.housing?.loans ?? []).toEqual([]);
  });
});

describe("a joint loan paid from a joint account (e)", () => {
  const joint = (over: Partial<Account> = {}) => loanAccount({ holder: "Matti Meikalainen, Maija Meikalainen", ...over });
  const partnerPays = carried(90_000, { in: { counterparty: "Maija Meikalainen", counterpartyIban: IBAN_PARTNER }, from: { counterpartyIban: IBAN_LOAN } });
  const half: Part = { from: 0, to: 1, of: 2 };

  it("is a payment account when the other holder pays in from an account that is not in the view", () => {
    const rows = partnerPays.filter((t) => t.accountId === "acc-2");
    expect(world([...salary, ...rows], [checking, joint()]).ctx.paymentAccounts.has("acc-2")).toBe(true);
    // a stranger by that name is no holder
    const stranger = carried(90_000, { in: { counterparty: "Kauppa Oy", counterpartyIban: IBAN_PARTNER } }).filter((t) => t.accountId === "acc-2");
    expect(world([...salary, ...stranger], [checking, joint()]).ctx.paymentAccounts.size).toBe(0);
  });

  it("is no debt in the own view at half, and Asuminen holds the instalment at the viewer's part", () => {
    const rows = [...salary, ...partnerPays.filter((t) => t.accountId === "acc-2")];
    const w = world(rows, [checking, joint()], [mark(loanKindSubject("mortgage", "out:acc-2:esimerkkipankki oyj#90000"), "in_use")], [], [balanceOf(checking), balanceOf(joint(), { part: half, joint: true, balanceCents: -23 })]);
    expect(w.holdings.loans).toEqual([]);
    expect(w.holdings.debtCents).toBe(0);
    expect(w.holdings.accounts.find((a) => a.id === "acc-2")).toMatchObject({ loanPayment: true });
  });

  it("reads an answer the same in both views", () => {
    const rows = [...salary, ...carried(90_000)];
    const key = loanProposals(createContext(rows, [checking, loanAccount()], today), inputs())[0]!.key;
    const told = [mark(loanKindSubject("mortgage", key), "in_use")];
    const own = world(rows, [checking, loanAccount()], told);
    expect(own.housing?.ask).toBe(false);
    expect(own.housing?.loans).toMatchObject([{ monthlyCents: 90_000 }]);
  });
});

describe("a user who said what the loan is (f)", () => {
  const rows = [...salary, ...direct(65_000, "Esimerkkirahoitus")];
  const key = loanProposals(createContext(rows, [checking], today), inputs())[0]!.key;

  it("wins over the inference and is never asked again", () => {
    const charge = MONTHS.slice(-6).map((m) => tx({ bookingDate: `${m}-03`, amountCents: -31_000, accountId: "acc-1", merchant: "As Oy Esimerkkitalo", counterparty: "AS OY ESIMERKKITALO", description: "Hoitovastike", category: "housing", categorySource: "rule" }));
    const w = world([...rows, ...charge], [checking], [mark(loanKindSubject("car", key), "in_use")]);
    expect(loanProposals(w.ctx, w.input)[0]).toMatchObject({ kind: "car", placed: true });
    expect(w.housing?.loans ?? []).toEqual([]);
    expect(w.questions.items.some((q) => q.kind === "loan")).toBe(false);
  });

  it("is the latest answer where the user changed their mind, and holds after the payment moved", () => {
    const told = [mark(loanKindSubject("car", key), "in_use", "2026-10-01T08:00:00.000Z"), mark(loanKindSubject("student", key), "in_use", "2026-10-02T08:00:00.000Z")];
    expect(loanProposals(createContext(rows, [checking], today), inputs(told))[0]?.kind).toBe("student");
    const moved = [...salary, ...direct(65_000, "Esimerkkirahoitus").slice(0, 5), ...direct(66_500, "Esimerkkirahoitus").slice(5)];
    expect(loanProposals(createContext(moved, [checking], today), inputs(told))[0]).toMatchObject({ kind: "student", placed: true });
  });

  it("holds the answers' subject as the marks route reads it", () => {
    expect(parseLoanKindSubject(loanKindSubject("mortgage", key))).toEqual({ kind: "mortgage", key });
    expect(parseLoanKindSubject(`question:loan-kind:castle:${key}`)).toBeNull();
    expect(parseLoanKindSubject("question:loan-kind:car:nothing")).toBeNull();
    expect(parseLoanKindSubject("question:mortgage")).toBeNull();
  });

  it("is never asked of a series the user said is no loan", () => {
    const w = world(rows, [checking], [mark(`loan-proposal:${key}`, "dismissed")]);
    expect(w.questions.items.some((q) => q.kind === "loan")).toBe(false);
  });
});

describe("the dashboard", () => {
  it("carries the payment account and the kind question through the first page", () => {
    const balances = [balanceOf(checking), balanceOf(loanAccount(), { loanPayment: true })];
    const ctx = createContext([...salary, ...carried(90_000)], [checking, loanAccount()], today);
    const page = buildDashboard(ctx, range, balances, inputs());
    expect(page.holdings.loans).toEqual([]);
    expect(page.questions.items.some((q) => q.kind === "loan")).toBe(true);
  });
});
