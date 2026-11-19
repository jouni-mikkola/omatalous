/**
 * A bank that issues cards and lends otherwise, paid by its name alone in changing sums: the rows tell no card, so the
 * payments are a credit of unknown kind (loans), counted once as debt service and asked in Tarkistettavat. A card word or
 * a connected card of the bank makes them the card's bills, one fixed sum is an instalment, and the household's answer
 * (a saved card, credit account or consumer credit linked to the series) settles the kind. Sums are made up.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { seriesMarkSubject } from "../src/analysis/subscription-alerts.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { addMonths } from "../src/dates.ts";
import { buildHoldings, unsavedDebts } from "../src/holdings.ts";
import { loanProposals } from "../src/loan-detect.ts";
import { notLoanMark } from "../src/loan-mark.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { loansReport } from "../src/reports/loans.ts";
import { unconnectedCards, unlinkedCreditLoans } from "../src/unconnected-cards.ts";
import { type Account, type Loan, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-20";
const RANGE = { from: "2025-10-01", to: "2026-09-30" };
const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
/** The bank's own card, connected: its name names the bank. */
const issuerCard: Account = { id: "card", name: "Bank Norwegian", bank: "Bank Norwegian", iban: null, currency: "EUR", type: "credit_card" };
/** Euros of the eight monthly payments: no three of them within a tenth of the middle one, as a card's or a credit account's. */
const CHANGING = [180, 420, 260, 510, 230, 390, 470, 205];
const ISSUER = "BANK NORWEGIAN";
const KEY = "out:chk:Bank Norwegian";

let n = 0;
/** One payment a month to the bank, the last in October 2026. */
function payments(euros: readonly number[] | number, description: string, counterparty = ISSUER, day = 12): Transaction[] {
  const sums = typeof euros === "number" ? Array.from({ length: 8 }, () => euros) : euros;
  return sums.map((sum, i) => {
    const month = addMonths("2026-10", i - (sums.length - 1));
    return tx({ id: `p${++n}`, accountId: "chk", bookingDate: `${month}-${String(day).padStart(2, "0")}`, amountCents: -sum * 100, counterparty, description, merchant: normalizeMerchant(counterparty, description) });
  });
}
const pay = Array.from({ length: 13 }, (_, i) => tx({ id: `pay${i}`, accountId: "chk", bookingDate: `${addMonths("2026-10", i - 12)}-15`, amountCents: 350_000, counterparty: "ESIMERKKI OY", description: "PALKKA", merchant: "Esimerkki" }));

function enriched(rows: readonly Transaction[], accounts: readonly Account[] = [checking], loans?: readonly Loan[]): Transaction[] {
  const changed = new Map(enrichTransactions(rows, accounts, [], undefined, undefined, undefined, undefined, loans).map((t) => [t.id, t]));
  return rows.map((t) => changed.get(t.id) ?? t);
}
const contextOf = (rows: readonly Transaction[], accounts: readonly Account[] = [checking], loans?: readonly Loan[]) => createContext(enriched(rows, accounts, loans), accounts, TODAY);
const issuerRows = (rows: readonly Transaction[]) => rows.filter((t) => t.counterparty === ISSUER);
const categoriesOf = (rows: readonly Transaction[]) => [...new Set(issuerRows(rows).map((t) => t.category))];

const saved = (kind: Loan["kind"], seriesKey: string | null, more: Partial<Loan> = {}): Loan => ({
  id: `l-${kind}`, name: "Esimerkkiluotto", lender: null, kind, grantedCents: null, balanceCents: 240_000, balanceDate: "2026-10-01",
  rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null,
  limitCents: kind === "consumer" ? null : 500_000, seriesKey, ...more,
});
const withLoans = (...loans: Loan[]): UserInputs => ({ ...NO_INPUTS, loans });

const rows = [...pay, ...payments(CHANGING, "VIITE 1234 5678")];

describe("the evidence of a card", () => {
  it("the bank's name alone is a credit of unknown kind, never a card bill", () => {
    expect(categoriesOf(enriched(rows))).toEqual(["loans"]);
  });

  it("a card word in the text, or a connected card of the bank, makes the payments the card's bills", () => {
    for (const word of ["KORTTILASKU", "LUOTTOKORTTI 09", "MASTERCARD"]) expect(categoriesOf(enriched([...pay, ...payments(CHANGING, word)])), word).toEqual(["card_bill"]);
    const withCard = enriched(rows, [checking, issuerCard]);
    expect(issuerRows(withCard).every((t) => t.category === "card_bill" || t.isTransfer)).toBe(true);
  });

  it("a loan word beside the bank's name stays a loan whatever the evidence", () => {
    expect(categoriesOf(enriched([...pay, ...payments(CHANGING, "LAINAN LYHENNYS")], [checking, issuerCard]))).toEqual(["loans"]);
  });
});

describe("the question of the kind", () => {
  const ctx = contextOf(rows);

  it("a monthly series of changing sums is asked: one proposal of unknown kind, keyed with no amount, never placed", () => {
    const [p, ...rest] = loanProposals(ctx, NO_INPUTS);
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ key: KEY, payee: "Bank Norwegian", kindUnknown: true, placed: false, plan: false, category: "loans" });
    expect(p!.kind).not.toBe("mortgage");
    expect(unconnectedCards(ctx, NO_INPUTS)).toEqual([]);
  });

  it("one fixed sum month after month is an instalment: placed, of a known kind, with no question of the kind", () => {
    const [p] = loanProposals(contextOf([...pay, ...payments(150, "VIITE 1234 5678")]), NO_INPUTS);
    expect(p).toMatchObject({ placed: true, kind: "consumer" });
    expect(p!.kindUnknown).toBeUndefined();
  });

  it("a finance company that lends for cars and issues cards is asked too when the sum changes, and keeps its loan guess for one sum", () => {
    const finance = (euros: readonly number[] | number) => payments(euros, "VIITE 1234 5678", "NORDEA RAHOITUS SUOMI OY");
    const changing = finance(CHANGING);
    expect(new Set(enriched([...pay, ...changing]).filter((t) => t.amountCents < 0).map((t) => t.category))).toEqual(new Set(["loans"]));
    expect(loanProposals(contextOf([...pay, ...changing]), NO_INPUTS)).toEqual([expect.objectContaining({ kindUnknown: true, placed: false })]);
    const fixed = loanProposals(contextOf([...pay, ...finance(150)]), NO_INPUTS);
    expect(fixed.map((p) => p.kindUnknown)).toEqual([undefined]);
    // its connected card named in the payment makes the changing sums the card's bills
    const gold: Account = { id: "gold", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" };
    const ids = new Set(changing.map((t) => t.id));
    expect(enriched([...pay, ...changing], [checking, gold]).filter((t) => ids.has(t.id)).every((t) => t.category === "card_bill" || t.isTransfer)).toBe(true);
  });

  it("is listed beside the debts as a credit of unknown kind with its monthly payment and no balance", () => {
    const { rows: listed, total } = unsavedDebts(ctx, NO_INPUTS);
    expect(listed).toEqual([{ name: "Bank Norwegian", monthlyCents: expect.any(Number), card: false, kindUnknown: true }]);
    expect(listed[0]!.monthlyCents).toBeGreaterThan(0);
    expect(total).toMatchObject({ count: 1 });
    const holdings = buildHoldings(ctx, [], NO_INPUTS);
    expect(holdings.unsavedLoans?.rows).toEqual(listed);
    expect(loansReport(ctx, [], NO_INPUTS).unsaved).toEqual(listed);
  });

  it("is mandatory debt service, counted once", () => {
    const year = buildDashboard(ctx, RANGE).totals;
    const inRange = issuerRows(ctx.txs).filter((t) => t.bookingDate >= RANGE.from && t.bookingDate <= RANGE.to);
    expect(year.debtCents).toBe(inRange.reduce((sum, t) => sum - t.amountCents, 0));
    expect(year.consumptionCents).toBe(0);
    expect(ctx.txs.filter((t) => t.counterparty === ISSUER).every((t) => t.kind === "debt" && t.flows.consumption === 0)).toBe(true);
  });
});

describe("what the household already answered stays answered", () => {
  it("a card saved from the card question before keeps its key: no question, and its rows are the card's bills", () => {
    // the key a card nobody connected was saved with: the series id with no amount (unconnected-cards.ts)
    const inputs = withLoans(saved("card", KEY));
    const ctx = contextOf(rows, [checking], inputs.loans);
    expect(loanProposals(ctx, inputs)).toEqual([]);
    expect(unconnectedCards(ctx, inputs)).toEqual([]);
    expect(unsavedDebts(ctx, inputs).rows).toEqual([]);
    expect(categoriesOf(ctx.txs)).toEqual(["card_bill"]);
    // the key is asked of the series before the rows move too
    expect(loanProposals(contextOf(rows), inputs)).toEqual([]);
  });

  it("Ei ole laina made of such a series holds, and so does a series marked as ended", () => {
    const ctx = contextOf(rows);
    const [p] = loanProposals(ctx, NO_INPUTS);
    expect(loanProposals(ctx, { ...NO_INPUTS, marks: [{ ...notLoanMark(p!), markedAt: "2026-10-10T09:00:00" }] })).toEqual([]);
    const series = ctx.recurring.find((s) => s.id === p!.seriesId)!;
    expect(loanProposals(ctx, { ...NO_INPUTS, marks: [{ subject: seriesMarkSubject(series), mark: "cancelled", markedAt: "2026-10-10T09:00:00" }] })).toEqual([]);
  });
});

describe("the answer of the kind", () => {
  const before = buildDashboard(contextOf(rows), RANGE).totals;

  it("a card moves the series to the card's bills: not asked again in either question, the debt service unchanged", () => {
    const inputs = withLoans(saved("card", KEY));
    const ctx = contextOf(rows, [checking], inputs.loans);
    expect(categoriesOf(ctx.txs)).toEqual(["card_bill"]);
    expect(issuerRows(ctx.txs).every((t) => t.categorySource === "rule" && !t.isTransfer)).toBe(true);
    expect(unconnectedCards(ctx, inputs)).toEqual([]);
    expect(loanProposals(ctx, inputs)).toEqual([]);
    const after = buildDashboard(ctx, RANGE).totals;
    expect(after.debtCents).toBe(before.debtCents);
    expect(after.expenseCents).toBe(before.expenseCents);
    expect(after.consumptionCents).toBe(before.consumptionCents);
    const report = loansReport(ctx, [], inputs);
    expect(report.unsaved).toEqual([]);
    expect(report.total.cents).toBe(loansReport(contextOf(pay), [], inputs).total.cents);
  });

  it.each(["credit_line", "consumer"] as const)("a %s keeps the payments as Kulutusluotot and is not asked again", (kind) => {
    const inputs = withLoans(saved(kind, KEY));
    const ctx = contextOf(rows, [checking], inputs.loans);
    expect(categoriesOf(ctx.txs)).toEqual(["loans"]);
    expect(loanProposals(ctx, inputs)).toEqual([]);
    expect(buildDashboard(ctx, RANGE).totals.debtCents).toBe(before.debtCents);
  });

  it("removing the saved card returns the payments to Kulutusluotot and asks again", () => {
    const answered = enriched(rows, [checking], [saved("card", KEY)]);
    expect(categoriesOf(answered)).toEqual(["card_bill"]);
    const removed = enriched(answered, [checking], []);
    expect(categoriesOf(removed)).toEqual(["loans"]);
    expect(loanProposals(createContext(removed, [checking], TODAY), NO_INPUTS).map((p) => p.key)).toEqual([KEY]);
  });

  it("a card's key moves no instalment another saved loan is paid by, nor a payment that names a loan", () => {
    const instalment = payments(100, "VIITE 9999 0000", ISSUER, 25);
    const loanText = payments(60, "LAINAN LYHENNYS", ISSUER, 3);
    const loans = [saved("card", KEY), saved("consumer", `${KEY}#10000`, { id: "l-instalment" })];
    const out = enriched([...rows, ...instalment, ...loanText], [checking], loans);
    const ids = (list: readonly Transaction[]) => new Set(list.map((t) => t.id));
    const [kept, worded] = [ids(instalment), ids(loanText)];
    expect(out.filter((t) => kept.has(t.id) || worded.has(t.id)).every((t) => t.category === "loans")).toBe(true);
    expect(out.filter((t) => t.counterparty === ISSUER && !kept.has(t.id) && !worded.has(t.id)).every((t) => t.category === "card_bill")).toBe(true);
  });
});

describe("a saved credit with no link beside the credit of unknown kind", () => {
  const ctx = contextOf(rows);
  /** The same household with no payment to the bank: what the saved credit alone makes of each figure. */
  const alone = contextOf(pay);

  it.each(["card", "credit_line", "consumer"] as const)("a saved %s and the row both show, and no figure counts the same money twice", (kind) => {
    const inputs = withLoans(saved(kind, null));
    expect(unsavedDebts(ctx, inputs).rows).toEqual([expect.objectContaining({ kindUnknown: true })]);
    expect(unconnectedCards(ctx, inputs)).toEqual([]);
    const [report, base] = [loansReport(ctx, [], inputs), loansReport(alone, [], inputs)];
    // Velat yhteensä: the saved credit's balance once, and the row adds none
    expect(report.total.cents).toBe(base.total.cents);
    expect(report.total.cents).toBeGreaterThan(0);
    expect(buildHoldings(ctx, [], inputs).debtCents).toBe(buildHoldings(alone, [], inputs).debtCents);
    // the monthly debt payments of the saved loans: the row's payment is in none of them
    expect(report.payments).toEqual(base.payments);
    // the year's cost: a debt with no terms leaves it unknown, never a sum that counts the row's money again
    expect(report.cost12).toEqual({ cents: null, interestCents: null, feeCents: null });
    // the payments are debt service once, whatever is saved
    expect(buildDashboard(ctx, RANGE, [], inputs).totals.debtCents).toBe(buildDashboard(ctx, RANGE).totals.debtCents);
  });

  it("the credits the row may be are the cards, credit accounts and consumer credits saved with no series and no account", () => {
    const loans = [saved("card", null), saved("credit_line", null), saved("consumer", null), saved("mortgage", null), saved("car", null), { ...saved("card", KEY), id: "linked" }, { ...saved("credit_line", null), id: "own-account", accountId: "acc" }];
    expect(unlinkedCreditLoans(withLoans(...loans)).map((l) => l.id)).toEqual(["l-card", "l-credit_line", "l-consumer"]);
  });

  it("linked to the series, the row goes and the totals stay", () => {
    const unlinked = withLoans(saved("consumer", null));
    const linked = withLoans(saved("consumer", KEY));
    expect(unsavedDebts(ctx, linked).rows).toEqual([]);
    const report = loansReport(ctx, [], linked);
    expect(report.total.cents).toBe(loansReport(ctx, [], unlinked).total.cents);
    expect(report.unsaved).toEqual([]);
    expect(buildDashboard(ctx, RANGE, [], linked).totals.debtCents).toBe(buildDashboard(ctx, RANGE).totals.debtCents);
  });
});
