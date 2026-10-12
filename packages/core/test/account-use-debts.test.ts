/**
 * Debts, a loan's payments, the split of income per person and the proposed weights of a joint account, by parts. A
 * member's own view is built by hand as the server hands it: an account's balance and limit at the viewer's part with
 * `part` set, and rows cut to the part with the bank's amount in `wholeCents`. The household's view holds every
 * account whole. Made-up names and sums only.
 */
import { describe, expect, it } from "vitest";
import { partCents, partOf, WHOLE } from "../src/account-use.ts";
import { suggestWeights } from "../src/account-use-suggest.ts";
import { createContext } from "../src/analysis/context.ts";
import { addMonths } from "../src/dates.ts";
import { buildHoldings } from "../src/holdings.ts";
import { householdDebts, paidFrom } from "../src/household-debts.ts";
import { loanProposals } from "../src/loan-detect.ts";
import { creditUse, loanBalanceOn } from "../src/loans.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { nameOf } from "../src/person-names.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { balanceReport } from "../src/reports/balances.ts";
import { incomeReport } from "../src/reports/income.ts";
import { type LoanRow, loansReport } from "../src/reports/loans.ts";
import { type Account, type AccountUse, type BalanceInput, type Loan, NO_INPUTS, type Part, type Transaction, type UserInputs } from "../src/types.ts";
import { series, tx } from "./helpers.ts";
import { JOINT_PAYERS, jointMortgage } from "./kit/events/joint-mortgage.ts";
import { KIT_TODAY, kitHousehold } from "./kit/index.ts";

const TODAY = "2026-10-15";
const OTHER = "Muu tilinomistaja";
const use = (...users: [string | null, number][]): AccountUse => ({ users: users.map(([userId, weight]) => ({ userId, label: userId ?? OTHER, weight })), source: "said" });
const EQUAL = use(["u-aino", 1], ["u-eero", 1]);
const AINO = partOf(EQUAL, "u-aino");
const EERO = partOf(EQUAL, "u-eero");

const account = (id: string, type: Account["type"], balanceCents: number | null, more: Partial<BalanceInput> = {}): BalanceInput => ({ id, name: id, type, balanceCents, ownerName: null, balanceAt: null, ...more });
const accountOf = (b: BalanceInput): Account => ({ id: b.id, name: b.name, iban: null, currency: "EUR", type: b.type });
/** The account as a user's own view holds it: the balance and the limit at the part. */
const own = (b: BalanceInput, part: Part, of: AccountUse = EQUAL): BalanceInput => ({
  ...b,
  balanceCents: b.balanceCents === null ? null : partCents(b.balanceCents, part),
  ...(b.creditLimitCents != null ? { creditLimitCents: partCents(b.creditLimitCents, part) } : {}),
  part,
  use: of,
});
const loan = (p: Partial<Loan> & Pick<Loan, "id" | "balanceCents">): Loan => ({
  name: p.id, lender: null, kind: "consumer", grantedCents: null, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null, ...p,
});
const inputs = (...loans: Loan[]): UserInputs => ({ ...NO_INPUTS, loans });
const sum = (cents: readonly number[]) => cents.reduce((a, b) => a + b, 0);

const joint = account("joint", "checking", 123_457);
/** An annuity whose plan has moved 21 payments on from an odd balance, paid from the joint account. */
const mortgage = loan({
  id: "home", name: "Asuntolaina", kind: "mortgage", balanceCents: 14_999_999, balanceDate: "2025-01-05", rateBp: 325, reference: "euribor_12", marginBp: 75,
  repayment: "annuity", intervalMonths: 1, paymentCents: 84_001, seriesKey: "out:joint:NORDEA BANK ABP#84001",
});

function view(balances: BalanceInput[], ...loans: Loan[]) {
  const ctx = createContext([], balances.map(accountOf), TODAY);
  const report = balanceReport(ctx, { from: "2026-06-01", to: TODAY }, balances, inputs(...loans));
  return { debts: householdDebts(balances, inputs(...loans), TODAY), loans: loansReport(ctx, balances, inputs(...loans)), report, holdings: buildHoldings(ctx, balances, inputs(...loans)) };
}
const owed = (h: ReturnType<typeof buildHoldings>) => sum(h.cards.map((c) => c.usedCents ?? 0)) + sum(h.loans.map((l) => l.leftCents ?? 0));

describe("a debt's part", () => {
  const all = view([{ ...joint, use: EQUAL }], mortgage);
  const hers = view([own(joint, AINO)], mortgage);
  const his = view([own(joint, EERO)], mortgage);
  const whole = loanBalanceOn(mortgage, TODAY).cents!;

  it("a mortgage typed in and paid from a joint account at 1 and 1 is half in each own view and whole in the household's", () => {
    expect(whole).toBeGreaterThan(14_000_000);
    expect(all.debts.total.cents).toBe(whole);
    expect(hers.debts.total.cents).toBe(partCents(whole, AINO));
    expect(his.debts.total.cents).toBe(partCents(whole, EERO));
    expect(hers.debts.total.cents + his.debts.total.cents).toBe(whole);
    expect(Math.abs(hers.debts.total.cents - his.debts.total.cents)).toBeLessThanOrEqual(1);
    // the row says the part where it is below the whole, and the list keeps the loan as typed
    expect([all, hers, his].map((v) => v.loans.loans[0]!.part)).toEqual([undefined, AINO, EERO]);
    expect(all.debts.saved[0]).toBe(mortgage);
    expect(hers.debts.saved[0]).toEqual({ ...mortgage, part: AINO });
    expect([...his.debts.parts]).toEqual([["home", EERO]]);
  });

  it("every cent figure of the row, of the report and of the holdings adds up over the two own views to the cent", () => {
    const figures = (v: typeof all): (number | null)[] => {
      const r: LoanRow = v.loans.loans[0]!;
      return [
        r.balance.cents, r.payment.cents, r.payment.interestCents, r.payment.amortisationCents, r.interest.cents,
        ...r.scenarios.flatMap((s) => [s.paymentCents, s.interestCents]),
        v.loans.total.cents, v.loans.interest.cents, v.loans.payments.monthlyCents,
        v.report.debt.cents, v.report.debt.savedCents, v.report.accountsLessDebt.at(-1)!, v.holdings.debtCents, v.holdings.loans[0]!.leftCents, v.holdings.loans[0]!.monthlyPaymentCents,
      ];
    };
    const [a, h, e] = [figures(all), figures(hers), figures(his)];
    expect(a).toHaveLength(18);
    expect(a.every((cents) => cents !== null && cents !== 0)).toBe(true);
    expect(h.map((cents, i) => cents! + e[i]!)).toEqual(a);
    // a row adds up within a view too, and used plus left is the debt total
    for (const v of [all, hers, his]) {
      const { payment } = v.loans.loans[0]!;
      expect(payment.cents).toBe(payment.interestCents! + payment.amortisationCents!);
      expect(owed(v.holdings)).toBe(v.holdings.debtCents);
      expect(v.holdings.debtCents).toBe(v.report.debt.cents);
    }
    expect(hers.holdings.loans[0]).toMatchObject({ id: "home", source: "typed", ownerName: null, part: AINO, use: EQUAL });
    expect(all.holdings.loans[0]).toMatchObject({ use: EQUAL });
    expect(all.holdings.loans[0]).not.toHaveProperty("part");
    expect(hers.holdings.accounts[0]).toMatchObject({ balanceCents: partCents(123_457, AINO), part: AINO, use: EQUAL });
  });

  it("the same loan is whole where its payments leave an account the viewer uses alone, and where no account in view is named", () => {
    const alone = view([{ ...joint, part: WHOLE, use: use(["u-aino", 1]) }], mortgage);
    expect(alone.debts.total.cents).toBe(whole);
    expect(alone.debts.parts.size).toBe(0);
    expect(alone.debts.saved[0]).toBe(mortgage);
    expect(alone.holdings.loans[0]).not.toHaveProperty("part");
    const half = [own(joint, AINO)];
    expect(paidFrom(mortgage, half)).toBe(half[0]);
    // near misses beside the joint account: no payments linked, another account, money in, and no series key at all
    for (const seriesKey of [null, "out:other:NORDEA BANK ABP#84001", "in:joint:NORDEA BANK ABP#84001", "NORDEA BANK ABP"]) {
      const typed = { ...mortgage, seriesKey };
      expect(paidFrom(typed, half), String(seriesKey)).toBeUndefined();
      expect(householdDebts(half, inputs(typed), TODAY).total.cents, String(seriesKey)).toBe(whole);
    }
  });

  it("a joint card with a limit: used and free are parts and add up to the part of the limit", () => {
    const card = account("card", "credit_card", -30_001, { creditLimitCents: 200_001 });
    const [a, h, e] = [view([{ ...card, use: EQUAL }]), view([own(card, AINO)]), view([own(card, EERO)])].map((v) => v.holdings);
    expect(a!.cards[0]).toMatchObject({ usedCents: 30_001, limitCents: 200_001, freeCents: 170_000, overCents: 0 });
    expect(h!.cards[0]).toMatchObject({ usedCents: 15_001, limitCents: 100_001, freeCents: 85_000, overCents: 0, part: AINO, use: EQUAL });
    expect(e!.cards[0]).toMatchObject({ usedCents: 15_000, limitCents: 100_000, freeCents: 85_000, overCents: 0, part: EERO });
    expect(a!.cards[0]).not.toHaveProperty("part");
    for (const v of [a!, h!, e!]) {
      expect(v.cards[0]!.usedCents! + v.cards[0]!.freeCents!).toBe(v.cards[0]!.limitCents);
      expect(v.debtCents).toBe(v.cards[0]!.usedCents);
    }
    // a card typed in, whose bills leave the joint account, is cut at the figure
    const typed = loan({ id: "typed", kind: "card", balanceCents: 30_001, limitCents: 200_001 });
    expect(creditUse({ ...typed, part: AINO }, TODAY)).toEqual({ usedCents: 15_001, limitCents: 100_001, share: 30_001 / 200_001, availableCents: 85_000, overCents: 0, unknown: null });
    const over = { ...typed, balanceCents: 250_001 };
    expect(creditUse({ ...over, part: AINO }, TODAY)).toMatchObject({ usedCents: 125_001, limitCents: 100_001, availableCents: 0, overCents: 25_000 });
    expect(creditUse({ ...over, part: EERO }, TODAY)).toMatchObject({ usedCents: 125_000, limitCents: 100_000, availableCents: 0, overCents: 25_000 });
    expect(creditUse(over, TODAY)).toMatchObject({ usedCents: 250_001, availableCents: 0, overCents: 50_000 });
    // without a limit the part has what the whole has: nothing to tell of the room
    expect(creditUse({ ...typed, limitCents: null, part: AINO }, TODAY)).toEqual({ usedCents: 15_001, limitCents: null, share: null, availableCents: null, overCents: null, unknown: "limit" });
  });

  it("a loan account at a part is told as the account holds it, and the typed terms of a linked loan are cut to stand beside it", () => {
    const bank = account("loan-acc", "loan", -9_000_001);
    const typed = loan({ id: "linked", kind: "mortgage", balanceCents: 9_100_000, balanceDate: "2026-09-01", repayment: "equal_principal", intervalMonths: 1, paymentCents: 50_001, grantedCents: 12_000_001, accountId: "loan-acc" });
    const [a, h, e] = [view([bank], typed), view([own(bank, AINO)], typed), view([own(bank, EERO)], typed)];
    expect(a.debts.connected[0]).toMatchObject({ id: "linked", balanceCents: 9_000_001, paymentCents: 50_001, grantedCents: 12_000_001 });
    expect(h.debts.connected[0]).toMatchObject({ id: "linked", balanceCents: 4_500_001, paymentCents: 25_001, grantedCents: 6_000_001 });
    expect(h.debts.connected[0]).not.toHaveProperty("part");
    expect(h.debts.sources[0]!.typed).toEqual({ ...typed, part: AINO });
    expect(a.debts.sources[0]!.typed).toBe(typed);
    expect([h, e].map((v) => v.loans.loans[0]!.part)).toEqual([AINO, EERO]);
    expect([a, h, e].map((v) => v.debts.total.cents)).toEqual([9_000_001, 4_500_001, 4_500_000]);
    expect(h.loans.loans[0]!.payment.amortisationCents! + e.loans.loans[0]!.payment.amortisationCents!).toBe(50_001);
    // the account alone, with no typed loan: the bank's part and nothing cut twice
    const alone = [view([bank]), view([own(bank, AINO)]), view([own(bank, EERO)])];
    expect(alone.map((v) => v.debts.total.cents)).toEqual([9_000_001, 4_500_001, 4_500_000]);
    expect(alone.map((v) => v.holdings.loans[0]!.leftCents)).toEqual([9_000_001, 4_500_001, 4_500_000]);
    expect(alone[1]!.holdings.loans[0]).toMatchObject({ id: "account:loan-acc", source: "account", part: AINO, use: EQUAL });
    expect([...alone[2]!.debts.parts]).toEqual([["account:loan-acc", EERO]]);
  });
});

describe("a loan's payments are matched whole", () => {
  const checking: Account = { id: "joint", name: "Yhteinen tili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
  /** One row a month to the lender, the last in October 2026; with a part, cut as an own view holds it. */
  const monthly = (count: number, cents: number, part: Part | null, description = "LAINANLYHENNYS 1234567", day = "05"): Transaction[] =>
    Array.from({ length: count }, (_, i) => {
      const bank = tx({ accountId: "joint", bookingDate: `${addMonths("2026-10", i - (count - 1))}-${day}`, amountCents: cents, counterparty: "NORDEA BANK ABP", description, merchant: normalizeMerchant("NORDEA BANK ABP", description) });
      return part ? { ...bank, amountCents: partCents(cents, part), wholeCents: cents } : bank;
    });
  const proposals = (rows: Transaction[], ...loans: Loan[]) => {
    const changed = new Map(enrichTransactions(rows, [checking], []).map((t) => [t.id, t]));
    return loanProposals(createContext(rows.map((t) => changed.get(t.id) ?? t), [checking], TODAY), inputs(...loans));
  };

  it("a payment of 1 000,00 on rows cut to 500,00 is proposed whole and matches the loan's typed payment", () => {
    const whole = proposals(monthly(8, -100_000, null));
    const cut = proposals(monthly(8, -100_000, AINO));
    expect(whole).toHaveLength(1);
    expect(whole[0]).toMatchObject({ paymentCents: 100_000, accountId: "joint" });
    expect(whole[0]!.key.endsWith("#100000")).toBe(true);
    // the proposal is the same in both views, row ids apart: the payment and the key are the bank's
    expect(cut.map((p) => ({ ...p, seriesId: "" }))).toEqual(whole.map((p) => ({ ...p, seriesId: "" })));
    const saved = loan({ id: "home", balanceCents: 15_000_000, paymentCents: 100_000, seriesKey: whole[0]!.key });
    // money out, and a refund from the lender beside it
    expect(proposals(monthly(8, -100_000, AINO), saved)).toEqual([]);
    expect(proposals([...monthly(8, -100_000, AINO), ...monthly(1, 5_000, AINO, "HYVITYS 1234567")], saved)).toEqual([]);
    expect(proposals(monthly(8, -100_000, null), saved)).toEqual([]);
    // a key that holds the part names the series in both views too
    const part = { ...saved, seriesKey: whole[0]!.key.replace("#100000", "#50000") };
    expect(proposals(monthly(8, -100_000, AINO), part)).toEqual([]);
    // near miss: a key at a payment neither the part nor the bank's amount is near is another loan
    expect(proposals(monthly(8, -100_000, AINO), { ...saved, seriesKey: whole[0]!.key.replace("#100000", "#300000") })).toHaveLength(1);
  });

  it("two loans to one lender have the same two keys in every view, so one saved in a view is proposed in no other", () => {
    const rowsOf = (part: Part | null) => [...monthly(10, -100_000, part), ...monthly(10, -30_000, part, "LAINANLYHENNYS 7654321", "12")];
    const save = (from: readonly { key: string; paymentCents: number }[]) => from.map((p, i) => loan({ id: `l${i}`, balanceCents: 1_000_000, paymentCents: p.paymentCents, seriesKey: p.key }));
    const whole = proposals(rowsOf(null));
    const cut = proposals(rowsOf(AINO));
    expect(whole.map((p) => [p.key.split("#")[1], p.paymentCents])).toEqual([["100000", 100_000], ["30000", 30_000]]);
    // the lender's two series carry their payment in the series id, and on cut rows that is the part: the key holds the bank's
    expect(cut.map((p) => p.seriesId.split("#")[1])).toEqual(["50000", "15000"]);
    expect(cut.map((p) => [p.key, p.paymentCents])).toEqual(whole.map((p) => [p.key, p.paymentCents]));
    // near miss: on whole rows the key is the series id as it stands
    expect(whole.map((p) => p.key)).toEqual(whole.map((p) => p.seriesId));
    // saved from the own view and read in both, and saved from the household's and read in the own
    expect(proposals(rowsOf(null), ...save(cut))).toEqual([]);
    expect(proposals(rowsOf(AINO), ...save(cut))).toEqual([]);
    expect(proposals(rowsOf(AINO), ...save(whole))).toEqual([]);
    // money back from the lender beside the payments changes nothing
    expect(proposals([...rowsOf(AINO), ...monthly(1, 5_000, AINO, "HYVITYS 1234567")], ...save(cut))).toEqual([]);
    // the use is said again at 600 and 400 after the loans were saved at a half
    const later = partOf(use(["u-aino", 60_000], ["u-eero", 40_000]), "u-eero");
    expect(proposals(rowsOf(later), ...save(cut))).toEqual([]);
    // near miss: with one of the two saved the other is still proposed, in both views
    expect(proposals(rowsOf(null), save(cut)[0]!).map((p) => p.paymentCents)).toEqual([30_000]);
    expect(proposals(rowsOf(AINO), save(cut)[1]!).map((p) => p.paymentCents)).toEqual([100_000]);
  });

  it("the smallest payment that is a loan's is told by the bank's amount", () => {
    expect(proposals(monthly(8, -3_000, AINO)).map((p) => p.paymentCents)).toEqual([3_000]);
    expect(proposals(monthly(8, -3_000, null)).map((p) => p.paymentCents)).toEqual([3_000]);
    expect(proposals(monthly(8, -1_500, null))).toEqual([]);
  });
});

describe("the split per person in Tulot", () => {
  const said = use(["u-aino", 60_000], ["u-eero", 40_000]);
  const accounts: Account[] = ["joint", "own", "other"].map((id) => ({ id, name: id, iban: null, currency: "EUR", type: "checking" }));
  const pay = (accountId: string, cents: number, more: Partial<Transaction>) =>
    Array.from({ length: 13 }, (_, i) => tx({ accountId, bookingDate: `${addMonths("2025-10", i)}-15`, amountCents: cents, categorySource: "rule", ...more }));
  const salary = { merchant: "ESIMERKKI OY", counterparty: "ESIMERKKI OY", category: "salary" };
  const rows = [
    ...pay("joint", 500_001, salary),
    ...pay("own", 300_000, { ...salary, merchant: "TOINEN OY", counterparty: "TOINEN OY" }),
    ...pay("other", 9_401, { merchant: "Kela", counterparty: "KELA", description: "KELA LAPSILISÄ", category: "benefits" }),
    // card purchases every other day, so the sync covers every month the report looks at
    ...series("2025-06-01", 2, 252, -2500, { accountId: "own", merchant: "K-Market", category: "groceries", categorySource: "rule" }),
  ];
  const ctx = createContext(rows, accounts, TODAY);
  const range = { from: "2025-11-01", to: TODAY };

  it("income on a joint account at 600 and 400 is split 60 to 40, and an account one member uses is theirs whoever linked it", () => {
    const balances = [
      account("joint", "checking", 0, { use: said, joint: true }),
      // Eero linked and shared it, Aino uses it alone
      account("own", "checking", 0, { ownerName: "Eero", use: use(["u-aino", 1]) }),
      account("other", "checking", 0, { use: use(["u-eero", 1], [null, 1]) }),
    ];
    const r = incomeReport(ctx, range, balances);
    expect(r.members).toEqual([
      { label: "u-aino", earnedCents: 12 * (300_001 + 300_000), regular: true },
      { label: "u-eero", earnedCents: 12 * (200_000 + 4_701), regular: true },
      { label: OTHER, earnedCents: 12 * 4_700, regular: true },
    ]);
    expect(sum(r.members!.map((m) => m.earnedCents))).toBe(r.earnedCents);
    expect(r.earnedCents).toBe(12 * (500_001 + 300_000 + 9_401));
    // a user who weighs nothing has no line
    const none = incomeReport(ctx, range, [account("joint", "checking", 0, { use: use(["u-aino", 1], ["u-eero", 0]), ownerName: "Eero" })]);
    expect(none.members).toEqual([{ label: "u-aino", earnedCents: 12 * 500_001, regular: true }]);
  });

  it("there is a split as soon as one account has two users, and none in a member's own view", () => {
    const one = [account("joint", "checking", 0, { use: said })];
    expect(incomeReport(ctx, range, one).members?.map((m) => m.earnedCents)).toEqual([12 * 300_001, 12 * 200_000]);
    // near miss: one user and nothing shared is a household of one
    expect(incomeReport(ctx, range, [account("joint", "checking", 0, { use: use(["u-aino", 1]) })]).members).toBeNull();
    // the own view: the rows of the account are the viewer's part already
    expect(incomeReport(ctx, range, [own(joint, AINO, said), account("own", "checking", 0, { ownerName: "Eero" })]).members).toBeNull();
    // an account with no use told is its owner's, and a joint one stays one line, as before
    const untold = [account("joint", "checking", 0, { joint: true }), account("own", "checking", 0, { ownerName: "Eero" })];
    expect(incomeReport(ctx, range, untold).members?.map((m) => [m.label, m.earnedCents])).toEqual([["Yhteinen tili", 12 * 500_001], ["Eero", 12 * 300_000]]);
  });
});

describe("the proposed weights of a joint account", () => {
  const [matti, maija] = JOINT_PAYERS.map((p) => p.name) as [string, string];
  const users = [
    { userId: "u-matti", name: nameOf("Matti Meikäläinen"), ibans: ["FI21 1234 5600 0007 85"] },
    { userId: "u-maija", name: nameOf("Maija Meikäläinen"), ibans: [] },
  ];
  const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const row = (month: string, cents: number, counterparty: string | null, more: Partial<Transaction> = {}) =>
    tx({ accountId: "joint", bookingDate: `${month}-01`, amountCents: cents, counterparty, description: "SIIRTO-MAKSU", merchant: counterparty ?? "", ...more });
  const each = (months: readonly string[], his: number, hers: number) => months.flatMap((m) => [row(m, his, matti), row(m, hers, maija)]);
  const weights = (rows: Transaction[], who = users) => suggestWeights(rows, { id: "joint" }, who, TODAY)?.map((u) => u.weight) ?? null;

  it("600 and 400 a month for six months give 60000 and 40000, from the kit's household too", () => {
    expect(suggestWeights(each(MONTHS, 60_000, 40_000), { id: "joint" }, users, TODAY)).toEqual([{ userId: "u-matti", weight: 60_000 }, { userId: "u-maija", weight: 40_000 }]);
    expect(suggestWeights(kitHousehold(jointMortgage).txs, { id: "chk" }, users, KIT_TODAY)).toEqual([{ userId: "u-matti", weight: 60_000 }, { userId: "u-maija", weight: 40_000 }]);
  });

  it("needs three months with money from two users, and counts from the first month somebody paid in", () => {
    expect(weights(each(MONTHS.slice(-2), 60_000, 40_000))).toBeNull();
    expect(weights(each(MONTHS.slice(-3), 60_000, 40_000))).toEqual([60_000, 40_000]);
    // six months of his and two of hers: one user alone tells no habit of two
    expect(weights([...MONTHS.map((m) => row(m, 60_000, matti)), ...MONTHS.slice(-2).map((m) => row(m, 40_000, maija))])).toBeNull();
    // she pays every other month, twice the sum: three months of two users, six months counted
    expect(weights([...MONTHS.map((m) => row(m, 60_000, matti)), ...[MONTHS[1]!, MONTHS[3]!, MONTHS[5]!].map((m) => row(m, 80_000, maija))])).toEqual([60_000, 40_000]);
  });

  it("sums within 5 % of each other are equal parts and no proposal", () => {
    expect(weights(each(MONTHS, 50_000, 50_000))).toBeNull();
    expect(weights(each(MONTHS, 50_000, 47_500))).toBeNull();
    expect(weights(each(MONTHS, 50_000, 47_499))).toEqual([50_000, 47_499]);
  });

  it("counts only money in from rows that name their payer, at the bank's amount", () => {
    const base = each(MONTHS, 60_000, 40_000);
    const beside = [
      // pay, a row of another account, the month in progress and a month before the six
      ...MONTHS.map((m) => row(m, 300_000, "ESIMERKKI OY")),
      ...MONTHS.map((m) => row(m, 90_000, maija, { accountId: "own" })),
      row("2026-10", 500_000, maija),
      row("2026-03", 500_000, maija),
    ];
    expect(weights([...base, ...beside])).toEqual([60_000, 40_000]);
    // money out to a user is not read, be it a transfer to their savings or a sum sent back
    expect(weights([...base, ...MONTHS.map((m) => row(m, -30_000, matti))])).toEqual([60_000, 40_000]);
    expect(weights([...base, row("2026-09", -600_000, maija)])).toEqual([60_000, 40_000]);
    // a payer account in view names its user with no name on the row
    expect(weights([...MONTHS.map((m) => row(m, 60_000, null, { counterpartyIban: "FI2112345600000785" })), ...MONTHS.map((m) => row(m, 40_000, maija))])).toEqual([60_000, 40_000]);
    // rows cut to a part are read whole
    expect(weights(each(MONTHS, 60_000, 40_000).map((t) => ({ ...t, amountCents: partCents(t.amountCents, AINO), wholeCents: t.amountCents })))).toEqual([60_000, 40_000]);
    // two users of one name: a row by that name tells neither
    expect(weights(base, [users[0]!, { ...users[0]!, userId: "u-other", ibans: [] }, users[1]!])).toBeNull();
  });
});
