/**
 * A card whose bills the household pays and whose account is not connected owes a sum no figure holds: it is asked once,
 * listed beside the loans nobody saved with its monthly bill, and left out once the household connected, saved or
 * dismissed it. Made-up issuer and sums.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildHoldings, unsavedDebts } from "../src/holdings.ts";
import { loanProposals, notLoanMark } from "../src/loan-detect.ts";
import { unconnectedCards, unlinkedCardLoans } from "../src/unconnected-cards.ts";
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

  it("leaves the card out once it is saved as a loan linked to its bills, or marked Ei ole laina", () => {
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

  it("is listed beside the debts as a card with its monthly bill, and counted in the loans left out of the total", () => {
    const { total, rows } = unsavedDebts(ctx, NO_INPUTS);
    expect(rows).toEqual([{ name: "Esimerkkipankki Kortti", monthlyCents: card!.monthlyCents, card: true }]);
    expect(total).toMatchObject({ count: 1, names: ["Esimerkkipankki Kortti"] });
    expect(buildHoldings(ctx, [], NO_INPUTS).unsavedLoans).toMatchObject({ count: 1, rows });
    expect(buildHoldings(ctx, [], { ...NO_INPUTS, loans: [savedCard(card!.key)] }).unsavedLoans).toBeUndefined();
  });
});
