/**
 * A card whose bills the household pays and whose account is not connected owes a sum no figure holds: it is asked once,
 * listed beside the loans nobody saved with its monthly bill, and left out once the household connected, saved or
 * dismissed it. Made-up issuer and sums.
 */
import { describe, expect, it } from "vitest";
import { billIssuer, issuerCards, missingCards } from "../src/analysis/card-bills.ts";
import { createContext } from "../src/analysis/context.ts";
import { completeYear } from "../src/analysis/data-quality.ts";
import { cardRowsMissingIn, paidCardBills } from "../src/analysis/usual.ts";
import { buildHoldings, unsavedDebts } from "../src/holdings.ts";
import { loanProposals, notLoanMark } from "../src/loan-detect.ts";
import { parseSeriesId } from "../src/series-id.ts";
import { cardGaps, unconnectedCards, unlinkedCardLoans } from "../src/unconnected-cards.ts";
import { type Account, type IsoDate, type Loan, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-20";
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

/** The bills of a card nobody connected, each month's a little different, as a card's are. */
const bills = (merchant: string, months: readonly string[] = MONTHS): Transaction[] =>
  months.map((m, i) => tx({ accountId: "own", bookingDate: `${m}-12` as IsoDate, amountCents: -(40_000 + i * 1_000), merchant, category: "card_bill" }));

const savedCard = (seriesKey: string): Loan => ({
  id: "l1", name: "Esimerkkikortti", lender: null, kind: "card", grantedCents: null, balanceCents: 120_000, balanceDate: TODAY,
  rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: 300_000, seriesKey,
});

describe("cards whose bills are paid and which are not connected", () => {
  const ctx = createContext(bills("Esimerkkipankki Kortti"), [own], TODAY);
  const [card] = unconnectedCards(ctx, NO_INPUTS);

  it("finds the card once, by its payee, with its monthly bill", () => {
    expect(unconnectedCards(ctx, NO_INPUTS)).toHaveLength(1);
    expect(card).toMatchObject({ payee: "Esimerkkipankki Kortti", accountId: "own", months: 6, lastDate: "2026-10-12" });
    expect(card!.monthlyCents).toBeGreaterThan(40_000);
    expect(card!.paymentCents).toBeGreaterThan(40_000);
  });

  it("finds none of a series of two bills, of a payee that is no card and of rows that are transfers", () => {
    expect(unconnectedCards(createContext(bills("Esimerkkipankki Kortti", MONTHS.slice(-2)), [own], TODAY), NO_INPUTS)).toEqual([]);
    expect(unconnectedCards(createContext(bills("Esimerkkipankki Kortti").map((t) => ({ ...t, category: "groceries" })), [own], TODAY), NO_INPUTS)).toEqual([]);
    expect(unconnectedCards(createContext(bills("Esimerkkipankki Kortti").map((t) => ({ ...t, category: "transfer", isTransfer: true })), [own], TODAY), NO_INPUTS)).toEqual([]);
  });

  it("leaves the card out once it is saved as a loan linked to its bills, or marked Ei ole velan maksu", () => {
    expect(unconnectedCards(ctx, { ...NO_INPUTS, loans: [savedCard(card!.key)] })).toEqual([]);
    const marked: UserInputs = { ...NO_INPUTS, marks: [{ ...notLoanMark(card!), markedAt: "2026-10-18T10:00:00Z" }] };
    expect(unconnectedCards(ctx, marked)).toEqual([]);
  });

  it("leaves the card out when a card loan was saved with no link to its bills, and a loan takes one card only", () => {
    const unlinked: Loan = { ...savedCard(""), seriesKey: null };
    const saved: UserInputs = { ...NO_INPUTS, loans: [unlinked] };
    expect(unconnectedCards(ctx, saved)).toEqual([]);
    const two = createContext([...bills("Esimerkkipankki Kortti"), ...bills("Toinenpankki Kortti")], [own], TODAY);
    expect(unconnectedCards(two, NO_INPUTS)).toHaveLength(2);
    expect(unconnectedCards(two, saved)).toHaveLength(1);
    // a card loan linked to a connected account is that card's, not one of these
    expect(unconnectedCards(ctx, { ...NO_INPUTS, loans: [{ ...unlinked, accountId: "kortti" }] })).toHaveLength(1);
    expect(unlinkedCardLoans(saved).map((l) => l.id)).toEqual(["l1"]);
    expect(unlinkedCardLoans({ ...NO_INPUTS, loans: [{ ...unlinked, kind: "consumer" }] })).toEqual([]);
  });

  it("keeps the other card listed once the saved loan is linked to one series, and lists none when both are taken", () => {
    const two = createContext([...bills("Esimerkkipankki Kortti"), ...bills("Toinenpankki Kortti").map((t) => ({ ...t, amountCents: t.amountCents + 10_000 }))], [own], TODAY);
    const [a, b] = unconnectedCards(two, NO_INPUTS);
    const unlinked: Loan = { ...savedCard(""), seriesKey: null };
    // one unlinked loan takes the larger series; the household says the loan is the smaller one, series B
    expect(unconnectedCards(two, { ...NO_INPUTS, loans: [unlinked] }).map((c) => c.key)).toEqual([b!.key]);
    expect(unconnectedCards(two, { ...NO_INPUTS, loans: [{ ...unlinked, seriesKey: b!.key }] }).map((c) => c.key)).toEqual([a!.key]);
    expect(unconnectedCards(two, { ...NO_INPUTS, loans: [{ ...unlinked, seriesKey: b!.key }, { ...unlinked, id: "l2", seriesKey: a!.key }] })).toEqual([]);
  });

  it("leaves the card out at once when a card account of its issuer is connected, even while its bills are still card bills", () => {
    const card: Account = { id: "kortti", name: "Esimerkkipankki Gold", iban: null, currency: "EUR", type: "credit_card" };
    // the card's first row is after the bills: they stay card bills for a billing month and more
    const opened = tx({ accountId: "kortti", bookingDate: "2026-10-01" as IsoDate, amountCents: -5_000, merchant: "Esimerkkikauppa" });
    const rows = [...bills("Esimerkkipankki Kortti"), opened];
    expect(unconnectedCards(createContext(rows, [own], TODAY), NO_INPUTS)).toHaveLength(1);
    expect(unconnectedCards(createContext(rows, [own, card], TODAY), NO_INPUTS)).toEqual([]);
    expect(unconnectedCards(createContext(rows, [own, { ...card, name: "Toinenpankki Gold" }], TODAY), NO_INPUTS)).toHaveLength(1);
  });

  it("is no loan proposal: its question is its own", () => {
    expect(loanProposals(ctx, NO_INPUTS)).toEqual([]);
  });

  it("is no card whose purchases are missing beside it: its question is the one of unconnectedCards", () => {
    expect(cardGaps(ctx, NO_INPUTS)).toEqual([]);
  });

  it("is listed beside the debts as a card with its monthly bill, and counted in the loans left out of the total", () => {
    const { total, rows } = unsavedDebts(ctx, NO_INPUTS);
    expect(rows).toEqual([{ debtId: `card_bill:${card!.key}`, name: "Esimerkkipankki Kortti", monthlyCents: card!.monthlyCents, card: true }]);
    expect(total).toMatchObject({ count: 1, names: ["Esimerkkipankki Kortti"] });
    expect(buildHoldings(ctx, [], NO_INPUTS).unsavedLoans).toMatchObject({ count: 1, rows });
    expect(buildHoldings(ctx, [], { ...NO_INPUTS, loans: [savedCard(card!.key)] }).unsavedLoans).toBeUndefined();
  });
});

describe("cards whose purchases are missing and which are not paid each month (cardGaps)", () => {
  const cardAccount = (id: string, name: string): Account => ({ id, name, iban: null, currency: "EUR", type: "credit_card" });
  const bill = (merchant: string, day: string, cents: number): Transaction => tx({ accountId: "own", bookingDate: day as IsoDate, amountCents: -cents, merchant, category: "card_bill" });
  const purchases = (accountId: string, from: string): Transaction[] => [0, 10, 20].map((d) => tx({ accountId, bookingDate: `${from}-${String(1 + d).padStart(2, "0")}` as IsoDate, amountCents: -2_000, merchant: "Esimerkkikauppa" }));
  // a connected card paid before its rows begin, a connected card whose rows begin inside the twelve months with no bill,
  // one bill of a card that is not connected, and a card paid each month that unconnectedCards asks about
  const later = cardAccount("later", "Kolmaspankki Gold");
  const late = cardAccount("late", "Neljaspankki Gold");
  const rows = [
    ...bills("Esimerkkipankki Kortti"),
    bill("Toinenpankki Kortti", "2026-08-12", 30_000),
    bill("Kolmaspankki Kortti", "2026-07-12", 20_000),
    bill("Kolmaspankki Kortti", "2026-08-12", 20_000),
    ...purchases("later", "2026-09"),
    ...purchases("late", "2026-05"),
  ];
  const ctx = createContext(rows, [own, later, late], TODAY);
  const gaps = cardGaps(ctx, NO_INPUTS);
  const loose = gaps.find((g) => g.cardId === null)!;

  it("lists the connected cards and the card with one bill, the largest bills first, a card with no bill last", () => {
    expect(gaps.map((g) => [g.payee, g.cardId, g.cents, g.lastDate, g.since])).toEqual([
      ["Kolmaspankki Gold", "later", 40_000, "2026-08-12", "2026-09-01"],
      ["Toinenpankki Kortti", null, 30_000, "2026-08-12", null],
      ["Neljaspankki Gold", "late", null, null, "2026-05-01"],
    ]);
    // a card that is not connected is saved as a loan by the key of its bill; a connected card's key names its account
    expect(parseSeriesId(loose.key)).toMatchObject({ direction: "out", accountId: "own" });
    expect(parseSeriesId(gaps[0]!.key)).toMatchObject({ direction: "out", accountId: "later" });
    expect(unconnectedCards(ctx, NO_INPUTS).map((c) => c.payee)).toEqual(["Esimerkkipankki Kortti"]);
  });

  it("gives every card of the figure of missing card purchases one row with unconnectedCards, and nothing else but a connected card whose rows begin late", () => {
    const missing = missingCards(ctx, completeYear(TODAY)).bills;
    const cardOf = issuerCards(ctx);
    const issuerOfGap = (g: (typeof gaps)[number]) => (g.cardId ? missing.find((m) => cardOf(m.issuer)?.id === g.cardId)?.issuer : billIssuer({ merchant: g.payee }));
    const listed = [...unconnectedCards(ctx, NO_INPUTS).map((c) => billIssuer({ merchant: c.payee })), ...gaps.filter((g) => g.cents !== null).map(issuerOfGap)];
    expect(listed.toSorted()).toEqual(missing.map((m) => m.issuer).toSorted());
    expect(gaps.filter((g) => g.cents === null).map((g) => g.cardId)).toEqual(["late"]);
  });

  it("leaves out a bill a saved loan or Ei ole velan maksu names, and a connected card linked to a loan of another kind", () => {
    const keys = (inputs: UserInputs) => cardGaps(ctx, inputs).map((g) => g.cardId ?? g.payee);
    expect(keys({ ...NO_INPUTS, loans: [savedCard(loose.key)] })).toEqual(["later", "late"]);
    expect(keys({ ...NO_INPUTS, marks: [{ ...notLoanMark(loose), markedAt: "2026-10-18T10:00:00Z" }] })).toEqual(["later", "late"]);
    const linked = (kind: Loan["kind"]): UserInputs => ({ ...NO_INPUTS, loans: [{ ...savedCard(""), seriesKey: null, kind, accountId: "later" }] });
    expect(keys(linked("consumer"))).toEqual(["Toinenpankki Kortti", "late"]);
    expect(keys(linked("card"))).toEqual(["later", "Toinenpankki Kortti", "late"]);
  });

  it("lets a card loan saved with no link take the largest card that is not connected, after the cards paid each month", () => {
    const two = createContext([bill("Toinenpankki Kortti", "2026-08-12", 30_000), bill("Viidespankki Kortti", "2026-06-12", 50_000)], [own], TODAY);
    const unlinked: UserInputs = { ...NO_INPUTS, loans: [{ ...savedCard(""), seriesKey: null }] };
    expect(cardGaps(two, NO_INPUTS).map((g) => g.payee)).toEqual(["Viidespankki Kortti", "Toinenpankki Kortti"]);
    expect(cardGaps(two, unlinked).map((g) => g.payee)).toEqual(["Toinenpankki Kortti"]);
    // the card paid each month takes the loan first
    expect(cardGaps(ctx, unlinked).map((g) => g.cardId ?? g.payee)).toEqual(["later", "Toinenpankki Kortti", "late"]);
  });

  it("counts a bill that names a connected card with no rows yet as that card's", () => {
    const fresh = cardAccount("fresh", "Toinenpankki Gold");
    const named = createContext([bill("Toinenpankki Kortti", "2026-08-12", 30_000)], [own, fresh], TODAY);
    expect(cardGaps(named, NO_INPUTS).map((g) => [g.cardId, g.cents])).toEqual([["fresh", 30_000]]);
  });

  it("has a row of Täydennä lainat wherever a month of the twelve lacks a card's purchases, the reason the first page links there", () => {
    const months = Array.from({ length: 12 }, (_, i) => `${i < 3 ? 2025 : 2026}-${String(((i + 9) % 12) + 1).padStart(2, "0")}`);
    const fixtures = [
      ctx,
      createContext(bills("Esimerkkipankki Kortti"), [own], TODAY),
      createContext([bill("Toinenpankki Kortti", "2026-08-12", 30_000)], [own], TODAY),
      createContext([bill("Kolmaspankki Kortti", "2026-08-12", 20_000), ...purchases("later", "2026-09")], [own, later], TODAY),
      createContext(purchases("late", "2026-05"), [own, late], TODAY),
    ];
    for (const fixture of fixtures) {
      expect(months.some((m) => paidCardBills(fixture, m) || cardRowsMissingIn(fixture, m))).toBe(true);
      expect(unconnectedCards(fixture, NO_INPUTS).length + cardGaps(fixture, NO_INPUTS).length).toBeGreaterThan(0);
    }
    expect(months[0]).toBe(completeYear(TODAY).from.slice(0, 7));
    expect(months[11]).toBe(completeYear(TODAY).to.slice(0, 7));
  });

  it("reads only card bills: a lender's payment with no word of a card is no card's row", () => {
    const lender = createContext([tx({ accountId: "own", bookingDate: "2026-08-12", amountCents: -30_000, merchant: "Esimerkkirahoitus", category: "loans" })], [own], TODAY);
    expect(cardGaps(lender, NO_INPUTS)).toEqual([]);
    expect(unconnectedCards(lender, NO_INPUTS)).toEqual([]);
  });
});
