/**
 * What the first page shows of accounts, cards and debts (`holdings.ts`): one answer, read by the balance report
 * (Saldot) and by the dashboard (Yhteenveto). It computes nothing of its own, so the tests hold it to the owners of the
 * figures: the debt total, the day walk and `loanBalanceOn`. Made-up accounts and loans only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { buildHoldings, cardLimitCents } from "../src/holdings.ts";
import { loanBalanceOn } from "../src/loans.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { balanceReport } from "../src/reports/balances.ts";
import { loansReport } from "../src/reports/loans.ts";
import type { Account, BalanceInput, Loan, Transaction, UserInputs } from "../src/types.ts";
import { ACCOUNTS, randomHistory, rng } from "./gen.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const range = { from: "2026-06-01", to: today };
const loan = (p: Partial<Loan> & Pick<Loan, "id" | "balanceCents">): Loan => ({
  name: p.id, lender: null, kind: "consumer", grantedCents: null, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null, ...p,
});
const input = (id: string, name: string, type: Account["type"], balanceCents: number | null, more: Partial<BalanceInput> = {}): BalanceInput => ({
  id, name, type, balanceCents, ownerName: null, balanceAt: null, ...more,
});
const inputsOf = (loans: Loan[]): UserInputs => ({ marks: [], expectedBills: [], loans });
const accountOf = (b: BalanceInput): Account => ({ id: b.id, name: b.name, iban: null, currency: "EUR", type: b.type });

/** The report and the dashboard of a household with no rows but the ones given. */
function household(balances: BalanceInput[], loans: Loan[] = [], txs: Transaction[] = [], on = today) {
  const accounts = balances.map(accountOf);
  const ctx = createContext(txs, accounts, on);
  const inputs = inputsOf(loans);
  const report = balanceReport(ctx, { ...range, to: on }, balances, inputs);
  return { ctx, report, holdings: report.holdings, dashboard: buildDashboard(ctx, { ...range, to: on }, balances, inputs) };
}

const owed = (h: ReturnType<typeof buildHoldings>) => h.cards.reduce((s, c) => s + (c.usedCents ?? 0), 0) + h.loans.reduce((s, l) => s + (l.leftCents ?? 0), 0);

describe("holdings of the balance report", () => {
  it("cards used plus loans left is the debt total to the cent, on every seeded household, in the report and on the first page", () => {
    const problems: string[] = [];
    let withLoans = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const r = rng(seed * 7919);
      const { txs, accounts, rules } = randomHistory(seed, 250);
      const on = "2025-11-15";
      const ctx = createContext(enrichTransactions(txs, accounts, rules), accounts, on);
      const cents = (max: number) => Math.round(r() * max);
      const balances = ACCOUNTS.map((a) => {
        // some households lack a balance on an account, some owe on the card and the loan account
        const none = r() < 0.15;
        const sign = a.type === "credit_card" || a.type === "loan" ? -1 : 1;
        return input(a.id, a.name, a.type, none ? null : sign * cents(a.type === "loan" ? 20_000_000 : 400_000), a.type === "credit_card" ? { creditLimitCents: 500_000, cardMask: "•••• 4242" } : {});
      });
      const saved = [
        loan({ id: `own-${seed}`, balanceCents: cents(900_000), kind: "consumer", repayment: "annuity", intervalMonths: 1, paymentCents: 20_000, rateBp: 500, balanceDate: "2025-10-01" }),
        // a typed card, and on every other seed one linked to the card account or to the loan account
        loan({ id: `typed-${seed}`, balanceCents: cents(300_000), kind: "card", limitCents: 300_000, balanceDate: "2025-10-20", accountId: seed % 3 === 0 ? "card" : seed % 3 === 1 ? "loan" : null }),
      ];
      if (seed % 3 !== 2) withLoans++;
      const inputs = inputsOf(saved);
      const report = balanceReport(ctx, { from: "2025-06-01", to: on }, balances, inputs);
      const dashboard = buildDashboard(ctx, { from: "2025-10-01", to: on }, balances, inputs);
      if (owed(report.holdings) !== report.holdings.debtCents) problems.push(`${seed}: ${owed(report.holdings)} against ${report.holdings.debtCents}`);
      if (report.holdings.debtCents !== report.debt.cents) problems.push(`${seed}: the debt total ${report.holdings.debtCents} against ${report.debt.cents}`);
      if (JSON.stringify(dashboard.holdings) !== JSON.stringify(report.holdings)) problems.push(`${seed}: the dashboard differs`);
      const known = report.holdings.accounts.filter((a) => a.balanceCents !== null);
      const added = known.length ? known.reduce((s, a) => s + a.balanceCents!, 0) : null;
      if (report.holdings.accountsCents !== added) problems.push(`${seed}: the accounts' total ${report.holdings.accountsCents} against ${added}`);
      // the cards' and the loans' totals are the two halves of the debt total, to the cent
      if ((report.holdings.cardsCents ?? 0) + (report.holdings.loansCents ?? 0) !== report.holdings.debtCents) problems.push(`${seed}: the cards' and the loans' totals against ${report.holdings.debtCents}`);
    }
    expect(problems).toEqual([]);
    expect(withLoans).toBeGreaterThan(10);
  }, 30_000);

  it("a card with a limit and a debt gives used and free that add up to the limit", () => {
    const { holdings } = household([input("card", "Esimerkkikortti", "credit_card", -120_000, { creditLimitCents: 500_000, cardMask: "•••• 1234", bank: "ESIMERKKIPANKKI" })]);
    expect(holdings.cards).toEqual([
      { id: "card", name: "Esimerkkikortti", bank: "ESIMERKKIPANKKI", ownerName: null, mask: "•••• 1234", limitCents: 500_000, usedCents: 120_000, freeCents: 380_000, overCents: 0, balanceAt: null },
    ]);
    const [c] = holdings.cards;
    expect(c!.usedCents! + c!.freeCents!).toBe(c!.limitCents);
  });

  it("a card with no limit gives free null and no share", () => {
    const { holdings } = household([input("card", "Kortti", "credit_card", -120_000), input("zero", "Nollaraja", "credit_card", -5_000, { creditLimitCents: 0 })]);
    expect(holdings.cards.map((c) => [c.limitCents, c.usedCents, c.freeCents, c.overCents])).toEqual([[null, 120_000, null, null], [null, 5_000, null, null]]);
  });

  it("a card with money on it is used 0 and never negative, and a card over its limit has nothing free and the excess told", () => {
    const { holdings, report } = household([
      input("refund", "Hyvityskortti", "credit_card", 4_500, { creditLimitCents: 200_000 }),
      input("full", "Taynna", "credit_card", -200_000, { creditLimitCents: 200_000 }),
      input("over", "Ylitetty", "credit_card", -230_000, { creditLimitCents: 200_000 }),
    ]);
    // at the limit is not over it
    expect(holdings.cards.map((c) => [c.usedCents, c.freeCents, c.overCents])).toEqual([[0, 200_000, 0], [200_000, 0, 0], [230_000, 0, 30_000]]);
    expect(report.debt.cents).toBe(430_000);
  });

  it("a card the bank gave no balance for has no use and no free, not zero", () => {
    const { holdings } = household([input("card", "Kortti", "credit_card", null, { creditLimitCents: 200_000, cardMask: "•••• 9999" })]);
    expect(holdings.cards).toMatchObject([{ limitCents: 200_000, usedCents: null, freeCents: null, overCents: null, mask: "•••• 9999" }]);
  });

  it("a saved loan linked to an account appears once, told by the account, and the debt total counts it once", () => {
    const home = loan({ id: "home", name: "Kodin laina", kind: "mortgage", balanceCents: 15_000_000, rateBp: 360, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, accountId: "loan-acc" });
    const { holdings, report } = household([input("loan-acc", "Asuntolaina", "loan", -14_912_345)], [home]);
    expect(holdings.loans).toHaveLength(1);
    expect(holdings.loans[0]).toMatchObject({ id: "home", name: "Kodin laina", kind: "mortgage", source: "account", maybeTwice: false, monthlyPaymentCents: 90_000 });
    expect(owed(holdings)).toBe(report.debt.cents);
  });

  it("a loan account with no saved loan is one loan in the holdings, the dashboard's holdings and the housing block, as the bank tells it", () => {
    const { holdings, report, dashboard } = household([input("loan-acc", "Asuntolaina", "loan", -14_912_345)]);
    const row = { id: "account:loan-acc", name: "Asuntolaina", kind: "mortgage", source: "account", leftCents: 14_912_345, monthlyPaymentCents: null, maybeTwice: false };
    expect(holdings.loans).toMatchObject([row]);
    expect(dashboard.holdings.loans).toMatchObject([row]);
    expect(report.debt.cents).toBe(14_912_345);
    // the block of the home lists it with the figures it cannot know left empty
    expect(dashboard.housing?.loans).toMatchObject([{ id: "account:loan-acc", name: "Asuntolaina", monthlyCents: null, rateBp: null, reference: null, marginBp: null, referenceBp: null }]);
    expect(dashboard.housing?.partial).toBe(true);
    // a name that does not say home loan stays out of the home block, in the loans
    const other = household([input("loan-acc", "Lainatili", "loan", -14_912_345)]);
    expect(other.holdings.loans).toMatchObject([{ kind: "other", leftCents: 14_912_345 }]);
    expect(other.dashboard.housing?.loans ?? []).toEqual([]);
  });

  it("a saved loan linked to a card is that card's use, and the card is not a loan too", () => {
    const typed = loan({ id: "cardloan", name: "Korttiluotto", kind: "card", balanceCents: 123_456, limitCents: 400_000, accountId: "card" });
    const { holdings, report } = household([input("card", "Esimerkkikortti", "credit_card", -80_000, { creditLimitCents: 500_000 })], [typed]);
    expect(holdings.loans).toEqual([]);
    // the pair counts as the saved loan: the account's balance, the loan's limit
    expect(holdings.cards).toMatchObject([{ name: "Esimerkkikortti", usedCents: 80_000, limitCents: 400_000, freeCents: 320_000, overCents: 0 }]);
    expect(owed(holdings)).toBe(report.debt.cents);
  });

  it("the excess over the limit follows the limit the debt carries, the saved loan's when one is linked", () => {
    const tight = loan({ id: "cardloan", name: "Korttiluotto", kind: "card", balanceCents: 80_000, limitCents: 50_000, accountId: "card" });
    const { holdings } = household([input("card", "Esimerkkikortti", "credit_card", -80_000, { creditLimitCents: 500_000 })], [tight]);
    expect(holdings.cards).toMatchObject([{ limitCents: 50_000, usedCents: 80_000, freeCents: 0, overCents: 30_000 }]);
  });

  it("a limit counts when it is above zero, and a limit of nothing or less is no limit", () => {
    expect([cardLimitCents(1), cardLimitCents(500_000), cardLimitCents(0), cardLimitCents(-1), cardLimitCents(null), cardLimitCents(undefined)]).toEqual([1, 500_000, null, null, null, null]);
  });

  it("a typed loan with no account is what is left today by its plan, with the payment of a month", () => {
    // 10 000 euros on the 1st of June, 500 a month with no interest: four payments are due by 9.10. (June to September)
    const typed = loan({ id: "study", name: "Opintolaina", lender: "ESIMERKKIRAHOITUS OY", balanceCents: 1_000_000, balanceDate: "2026-06-01", repayment: "fixed_instalment", intervalMonths: 1, paymentCents: 50_000, rateBp: 0 });
    const { holdings } = household([], [typed]);
    expect(holdings.loans).toEqual([
      { id: "study", name: "Opintolaina", lender: "ESIMERKKIRAHOITUS OY", kind: "consumer", ownerName: null, leftCents: loanBalanceOn(typed, today).cents, monthlyPaymentCents: 50_000, source: "typed", maybeTwice: false },
    ]);
    expect(holdings.loans[0]!.leftCents).toBeLessThan(typed.balanceCents);
  });

  it("an account with no balance from the bank appears with balance null, not 0", () => {
    const { holdings } = household([input("a", "Käyttötili", "checking", null), input("b", "Säästötili", "savings", 0, { balanceAt: "2026-10-05" })]);
    expect(holdings.accounts.map((a) => [a.id, a.type, a.balanceCents, a.balanceAt])).toEqual([["a", "checking", null, null], ["b", "savings", 0, "2026-10-05"]]);
  });

  it("an account's balance today is the day walk's: a row booked since the balance was given is in it, and Saldot's last month says the same", () => {
    const rows = [tx({ accountId: "a", bookingDate: "2026-10-07", amountCents: -2_500 })];
    const { holdings, report } = household([input("a", "Käyttötili", "checking", 100_000, { balanceAt: "2026-10-05" })], [], rows);
    expect(holdings.accounts[0]!.balanceCents).toBe(97_500);
    expect(report.accounts[0]!.values.at(-1)).toBe(97_500);
  });

  it("an account of type other is listed, so the accounts add up to Saldot's total", () => {
    const balances = [input("c1", "Käyttötili", "checking", -30_000), input("s1", "Säästötili", "savings", 500_000), input("o1", "Rahastotili", "other", 100_000)];
    const { holdings, report } = household(balances);
    expect(holdings.accounts.map((a) => [a.id, a.type])).toEqual([["c1", "checking"], ["s1", "savings"], ["o1", "other"]]);
    expect(holdings.accounts.reduce((s, a) => s + (a.balanceCents ?? 0), 0)).toBe(570_000);
    expect(report.total.at(-1)).toBe(570_000);
    // money in and money out: the overdraft is taken off, once
    expect(holdings.accountsCents).toBe(570_000);
  });

  it("the accounts' total adds the known balances only: a card and a loan are not in it, an account without a balance leaves it out, and with none known it is null", () => {
    const some = household([input("c1", "Käyttötili", "checking", 120_050), input("s1", "Säästötili", "savings", null), input("k1", "Kortti", "credit_card", -9_000), input("l1", "Autolaina", "loan", -300_000)]);
    expect(some.holdings.accountsCents).toBe(120_050);
    // a refund that turns the account positive again changes the total by the same cents
    expect(household([input("c1", "Käyttötili", "checking", 120_050 + 2_500)]).holdings.accountsCents).toBe(122_550);
    expect(household([input("c1", "Käyttötili", "checking", 0)]).holdings.accountsCents).toBe(0);
    expect(household([input("c1", "Käyttötili", "checking", null), input("s1", "Säästötili", "savings", null)]).holdings.accountsCents).toBeNull();
    expect(household([input("k1", "Kortti", "credit_card", -9_000)]).holdings.accountsCents).toBeNull();
  });

  it("the cards' total adds the known use of each card and the loans' total the known balances of each loan, and each is null when none is known", () => {
    const card = (balanceCents: number | null, id = "k1") => input(id, `Kortti ${id}`, "credit_card", balanceCents, { creditLimitCents: 300_000 });
    const totals = (balances: BalanceInput[], loans: Loan[] = []) => {
      const { holdings } = household(balances, loans);
      return { cards: holdings.cardsCents, loans: holdings.loansCents, debt: holdings.debtCents };
    };
    // money out: two cards add up, a card the bank gave no balance for and a loan account without one are left out
    expect(totals([card(-1_000), card(-2_500, "k2"), card(null, "k3"), input("l1", "Autolaina", "loan", -300_000), input("l2", "Vanha laina", "loan", null)], [loan({ id: "x", balanceCents: 5_000 })])).toEqual({ cards: 3_500, loans: 305_000, debt: 308_500 });
    // spending on the card raises its total, a refund lowers it, and one that puts the card in credit leaves it at 0, never below
    expect(totals([card(-1_000)]).cards).toBe(1_000);
    expect(totals([card(-1_500)]).cards).toBe(1_500);
    expect(totals([card(-800)]).cards).toBe(800);
    expect(totals([card(2_000)]).cards).toBe(0);
    // a loan paid down to nothing is a known balance, and a payment on one lowers its total
    expect(totals([], [loan({ id: "x", balanceCents: 0 })]).loans).toBe(0);
    expect(totals([], [loan({ id: "x", balanceCents: 4_000 })]).loans).toBe(4_000);
    // none known is null, not 0
    expect(totals([card(null)]).cards).toBeNull();
    expect(totals([input("c1", "Käyttötili", "checking", 10_000)])).toEqual({ cards: null, loans: null, debt: 0 });
    expect(totals([input("l1", "Autolaina", "loan", null)]).loans).toBeNull();
  });

  it("an account carries the last four characters of its number as its mask, and none without a number or with less than four characters", () => {
    const given = (iban: string | null) => buildHoldings(createContext([], [{ id: "a", name: "Käyttötili", iban, currency: "EUR", type: "checking" }], today), [input("a", "Käyttötili", "checking", 1_000)], inputsOf([])).accounts[0]!.mask;
    expect(given("FI21 1234 5600 0007 85")).toBe("0785");
    expect(given("fi2112345600000785")).toBe("0785");
    expect(given("FI12")).toBe("FI12");
    expect(given("FI1")).toBeNull();
    expect(given(null)).toBeNull();
    expect(given("")).toBeNull();
    // a card is no account here and keeps the mask the bank gave it
    expect(household([input("k1", "Kortti", "credit_card", -9_000, { cardMask: "•••• 4321" })]).holdings.cards[0]!.mask).toBe("•••• 4321");
  });

  it("the debt total is the cards' use and the loans' left to the cent, and there is none for a household in credit", () => {
    const owing = household([input("c1", "Käyttötili", "checking", 10_000), input("k1", "Kortti", "credit_card", -1_000, { creditLimitCents: 300_000 }), input("l1", "Autolaina", "loan", -300_000)], [loan({ id: "x", balanceCents: 5_000 })]);
    expect(owing.holdings.debtCents).toBe(owed(owing.holdings));
    expect(owing.holdings.debtCents).toBe(owing.report.debt.cents);
    expect(owing.holdings.debtCents).toBe(306_000);
    const clear = household([input("c1", "Käyttötili", "checking", 10_000), input("k1", "Kortti", "credit_card", 2_000, { creditLimitCents: 300_000 })]);
    expect(clear.holdings.debtCents).toBe(0);
  });

  it("lists checking, savings and other accounts as accounts, cards as cards, and a loan account as a loan, each once and in the accounts' order", () => {
    const balances = [
      input("c1", "Käyttötili", "checking", 10_000),
      input("k1", "Kortti", "credit_card", -1_000),
      input("s1", "Säästötili", "savings", 20_000),
      input("l1", "Autolaina", "loan", -300_000),
      input("o1", "Muu tili", "other", 5_000),
    ];
    const { holdings } = household(balances);
    expect(holdings.accounts.map((a) => a.id)).toEqual(["c1", "s1", "o1"]);
    expect(holdings.cards.map((c) => c.id)).toEqual(["k1"]);
    expect(holdings.loans.map((l) => [l.id, l.source, l.leftCents])).toEqual([["account:l1", "account", 300_000]]);
  });

  it("names the debts that may be in the total twice, as the Lainat report does, and no others", () => {
    const savedLoan = loan({ id: "mine", name: "Oma laina", balanceCents: 400_000 });
    const other = loan({ id: "other", name: "Toinen", balanceCents: 100_000, kind: "card" });
    const { holdings } = household([input("l1", "Autolaina", "loan", -300_000)], [savedLoan, other]);
    // the connected loan account stands beside the saved loan that is no card; the saved card has no account beside it
    expect(Object.fromEntries(holdings.loans.map((l) => [l.id, l.maybeTwice]))).toEqual({ mine: true, other: false, "account:l1": true });
  });

  it("a loan another member typed in says who, as a typed row and as a linked account's, here and in the Lainat report, and no other row says anything", () => {
    const balances = [input("l1", "Asuntolaina", "loan", -300_000), input("l2", "Autolaina", "loan", -50_000)];
    const loans = [loan({ id: "mine", balanceCents: 400_000 }), loan({ id: "hers", balanceCents: 100_000, typedBy: "Aino" }), loan({ id: "pair", balanceCents: 310_000, typedBy: "Aino", accountId: "l1" })];
    const { ctx, holdings } = household(balances, loans);
    const rows = holdings.loans.map((l) => [l.id, l.source, l.typedBy]);
    expect(rows).toEqual([["mine", "typed", undefined], ["hers", "typed", "Aino"], ["pair", "account", "Aino"], ["account:l2", "account", undefined]]);
    for (const row of [holdings.loans[0]!, holdings.loans[3]!]) expect(row).not.toHaveProperty("typedBy");
    const listed = loansReport(ctx, balances, inputsOf(loans)).loans;
    expect(listed.map((l) => [l.id, l.typedBy])).toEqual(rows.map(([id, , typedBy]) => [id, typedBy]));
    expect(listed[0]).not.toHaveProperty("typedBy");
    // the name changes no figure: the linked pair is the account's balance once
    expect(owed(holdings)).toBe(400_000 + 100_000 + 300_000 + 50_000);
  });

  it("another member's accounts carry the owner's name as the series do, and a joint account is listed once", () => {
    const balances = [
      input("mine", "Käyttötili", "checking", 10_000),
      input("joint", "Yhteistili", "checking", 30_000, { joint: true }),
      input("eero", "Käyttötili (Eero)", "checking", 5_000, { ownerName: "Eero" }),
      input("eero-card", "Kortti (Eero)", "credit_card", -2_000, { ownerName: "Eero", cardMask: "•••• 5555", creditLimitCents: 100_000 }),
    ];
    const { holdings, report } = household(balances);
    expect(holdings.accounts.map((a) => [a.id, a.name, a.ownerName])).toEqual([["mine", "Käyttötili", null], ["joint", "Yhteistili", null], ["eero", "Käyttötili (Eero)", "Eero"]]);
    expect(holdings.accounts.map((a) => a.name)).toEqual(report.accounts.filter((s) => s.type === "checking").map((s) => s.name));
    expect(holdings.cards).toMatchObject([{ id: "eero-card", name: "Kortti (Eero)", ownerName: "Eero", mask: "•••• 5555", usedCents: 2_000, freeCents: 98_000 }]);
  });

  it("the dashboard carries the same holdings as the report", () => {
    const balances = [input("c1", "Käyttötili", "checking", 10_000), input("k1", "Kortti", "credit_card", -1_000, { creditLimitCents: 300_000 })];
    const { dashboard, holdings } = household(balances, [loan({ id: "x", balanceCents: 5_000 })]);
    expect(dashboard.holdings).toEqual(holdings);
    expect(dashboard.holdings).toEqual(buildHoldings(createContext([], balances.map(accountOf), today), balances, inputsOf([loan({ id: "x", balanceCents: 5_000 })])));
  });
});
