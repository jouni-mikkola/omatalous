/**
 * Loan proposals from bank rows: raw rows → categorise → series → `loanProposals`. Each rule of the proposal has a hit
 * and the near misses a household's statement really holds.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { dismissedIds, marksBySubject, seriesMarkSubject } from "../src/analysis/subscription-alerts.ts";
import { cancelledSubjects } from "../src/commitments.ts";
import { addMonths } from "../src/dates.ts";
import { loanProposals, notLoanKey, notLoanMark } from "../src/loan-detect.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { type Account, type Loan, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-15";
const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const gold: Account = { id: "gold", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" };

interface Payee {
  counterparty: string;
  description: string;
  /** The same on every row, or one for each row. */
  reference?: string | ((i: number) => string);
  account?: string;
  day?: number;
  /** Months before October 2026 the last charge is in: 0 is this month. */
  ended?: number;
}

/** One charge a month, the last one in October 2026 unless `ended` says earlier. `euros` is one sum or a sum for each month. */
function monthly(count: number, euros: number | ((i: number) => number), p: Payee): Transaction[] {
  return Array.from({ length: count }, (_, i) => {
    const month = addMonths("2026-10", i - (count - 1) - (p.ended ?? 0));
    const reference = typeof p.reference === "function" ? p.reference(i) : p.reference;
    const row = tx({
      accountId: p.account ?? "chk",
      bookingDate: `${month}-${String(p.day ?? 5).padStart(2, "0")}`,
      amountCents: -Math.round((typeof euros === "function" ? euros(i) : euros) * 100),
      description: p.description,
      counterparty: p.counterparty,
      merchant: normalizeMerchant(p.counterparty, p.description),
    });
    // the stored row carries the payment reference; core's Transaction does not name the field
    return reference === undefined ? row : ({ ...row, reference } as Transaction);
  });
}

function proposalsOf(rows: Transaction[], inputs: UserInputs = NO_INPUTS, accounts: Account[] = [checking]) {
  const changed = new Map(enrichTransactions(rows, accounts, []).map((t) => [t.id, t]));
  return loanProposals(createContext(rows.map((t) => changed.get(t.id) ?? t), accounts, TODAY), inputs);
}

const carLoan = (count = 6, euros: number | ((i: number) => number) = 250) =>
  monthly(count, euros, { counterparty: "TOYOTA FINANCE FINLAND OY", description: "AUTORAHOITUS 44512", reference: "00000 44512 00019" });
const mortgage = (count = 8, euros: number | ((i: number) => number) = 612.4) => monthly(count, euros, { counterparty: "NORDEA BANK ABP", description: "LAINANLYHENNYS 1234567" });
const pay = monthly(8, -3520, { counterparty: "TYÖNANTAJA OY", description: "PALKKA", day: 15, ended: 1 });

const savedLoan = (seriesKey: string | null): Loan => ({
  id: "loan-1",
  name: "Autolaina",
  lender: "Toyota Finance",
  kind: "car",
  grantedCents: 1_500_000,
  balanceCents: 1_200_000,
  balanceDate: "2026-09-30",
  rateBp: 495,
  reference: "fixed",
  marginBp: null,
  repayment: "annuity",
  intervalMonths: 1,
  paymentCents: 25_000,
  endDate: null,
  limitCents: null,
  seriesKey,
});

describe("a loan proposed from its payments", () => {
  it("a car loan paid six months to a finance company: the payee, the usual payment, the months seen and the key", () => {
    const [p, ...rest] = proposalsOf([...pay, ...carLoan()]);
    expect(rest).toEqual([]);
    expect(p).toEqual({
      key: "out:chk:Toyota Finance Finland#25000",
      seriesId: "out:chk:Toyota Finance Finland",
      payee: "Toyota Finance Finland",
      accountId: "chk",
      paymentCents: 25000,
      months: 6,
      firstDate: "2026-05-05",
      lastDate: "2026-10-05",
      category: "loans",
      kind: "car",
      reference: "4451200019",
    });
  });

  it("carries no guess at the balance or the rate", () => {
    const fields = Object.keys(proposalsOf(carLoan())[0]!);
    for (const guess of ["balanceCents", "rateBp", "grantedCents", "endDate"]) expect(fields).not.toContain(guess);
  });

  it("a mortgage debited by the bank has no reference and is proposed as a mortgage", () => {
    expect(proposalsOf(mortgage())).toMatchObject([{ payee: "Nordea Bank Abp", paymentCents: 61240, months: 8, category: "mortgage", kind: "mortgage", reference: null }]);
  });

  it("two loans come the larger payment first, and a second loan from one lender has its own key", () => {
    const second = monthly(5, 180, { counterparty: "NORDEA BANK ABP", description: "LAINANLYHENNYS 7654321", day: 20 });
    const all = proposalsOf([...mortgage(), ...second, ...carLoan()]);
    expect(all.map((p) => [p.payee, p.paymentCents])).toEqual([
      ["Nordea Bank Abp", 61240],
      ["Toyota Finance Finland", 25000],
      ["Nordea Bank Abp", 18000],
    ]);
    expect(new Set(all.map((p) => p.key)).size).toBe(3);
  });

  it("a payment the rate moved is one loan, proposed at what it is now", () => {
    expect(proposalsOf(mortgage(10, (i) => 600 + 4 * i))).toMatchObject([{ payee: "Nordea Bank Abp", months: 10, category: "mortgage" }]);
  });

  it("a car maker's finance company is a car loan without a car word in the text", () => {
    expect(proposalsOf(monthly(6, 250, { counterparty: "TOYOTA FINANCE FINLAND OY", description: "LASKU 44512" }))).toMatchObject([{ payee: "Toyota Finance Finland", category: "loans", kind: "car" }]);
  });

  it("the payee can be a person, also one named Laina when the text names the loan", () => {
    for (const counterparty of ["PEKKA VIRTANEN", "LAINA KORHONEN"]) {
      expect(proposalsOf(monthly(6, 50, { counterparty, description: "LAINAN LYHENNYS" }))).toMatchObject([{ paymentCents: 5000, kind: "consumer" }]);
    }
  });

  it("a company named Laina is a lender whatever the payment text says", () => {
    expect(proposalsOf(monthly(6, 90, { counterparty: "SUOMEN LAINA OY", description: "LASKU 1001" }))).toMatchObject([{ payee: "Suomen Laina Oy", paymentCents: 9000 }]);
  });
});

describe("what is never proposed", () => {
  it.each<[string, Transaction[]]>([
    ["rent", monthly(8, 1050, { counterparty: "SATO-ASUNNOT OY", description: "VUOKRA" })],
    ["a rent with a loan word in its text", monthly(8, 1050, { counterparty: "MATTI VUOKRANANTAJA", description: "VUOKRA JA LAINAOSUUS" })],
    ["an own transfer", monthly(8, 300, { counterparty: "MATTI MEIKÄLÄINEN", description: "OMA SIIRTO" })],
    ["a card bill", monthly(8, (i) => 400 + 37 * i, { counterparty: "NORDEA RAHOITUS SUOMI OY", description: "NORDEA GOLD LASKU" })],
    ["an insurance", monthly(8, 62.5, { counterparty: "LÄHITAPIOLA", description: "KOTIVAKUUTUS" })],
    ["a loan's payment protection, named LAINATURVA", monthly(8, 32, { counterparty: "NORDEA BANK ABP", description: "LAINATURVA 1234567" })],
    ["a loan's insurance at a lender", monthly(8, 32, { counterparty: "SANTANDER CONSUMER FINANCE OY", description: "LAINAVAKUUTUS 1234567" })],
    ["a subscription", monthly(8, 21.99, { counterparty: "NETFLIX", description: "NETFLIX.COM" })],
    ["an instalment under 20 €", monthly(8, 15, { counterparty: "SANTANDER CONSUMER FINANCE OY", description: "OSAMAKSU" })],
    ["an instalment that has been 20 € only twice", monthly(4, (i) => (i < 2 ? 15 : 25), { counterparty: "SANTANDER CONSUMER FINANCE OY", description: "OSAMAKSU" })],
    ["an instalment that is under 20 € now, though five earlier charges reached it", monthly(8, (i) => (i < 5 ? 20.5 : 19.5), { counterparty: "SANTANDER CONSUMER FINANCE OY", description: "OSAMAKSU" })],
    ["monthly deposits at a bank that also lends", monthly(6, 200, { counterparty: "BIGBANK AS SUOMEN SIVULIIKE", description: "" })],
    ["a bond bought every month", monthly(6, 100, { counterparty: "NORDEA BANK ABP", description: "OSAKEINDEKSILAINA MERKINTÄ" })],
    ["a lease at a car maker's finance company", monthly(6, 399, { counterparty: "VOLKSWAGEN FINANCIAL SERVICES", description: "YKSITYISLEASING 123" })],
    ["a lease at a lender whose rows are debt", monthly(6, 399, { counterparty: "SANTANDER CONSUMER FINANCE OY", description: "LEASINGVUOKRA 123" })],
    ["pocket money to a person named Laina", monthly(6, 50, { counterparty: "LAINA KORHONEN", description: "VIIKKORAHA" })],
    ["a housing company's finance charge", monthly(6, 310, { counterparty: "AS OY KOTIKATU", description: "RAHOITUSVASTIKE LYHENNYS" })],
    ["a housing company's loan paid down", monthly(6, 310, { counterparty: "AS OY KOTIKATU", description: "YHTIÖLAINAN LYHENNYS" })],
    ["two charges", carLoan(2)],
    ["a loan paid off in the spring", monthly(8, 250, { counterparty: "SANTANDER CONSUMER FINANCE OY", description: "LAINAN LYHENNYS", ended: 5 })],
    ["invoices that each bring their own reference", monthly(6, 120, { counterparty: "KLARNA BANK AB", description: "OSAMAKSU", reference: (i) => `77001${i}3` })],
    ["a collector's payment plan", monthly(8, 80, { counterparty: "INTRUM OY", description: "MAKSUSUUNNITELMA 5521" })],
    ["interest alone", monthly(8, 24, { counterparty: "NORDEA BANK ABP", description: "LUOTONKORKO" })],
    ["a loan paid every third month", [0, 3, 6, 9].map((ended) => monthly(1, 400, { counterparty: "SANTANDER CONSUMER FINANCE OY", description: "LAINAN LYHENNYS", ended })[0]!)],
  ])("%s", (_name, rows) => {
    expect(proposalsOf([...pay, ...rows])).toEqual([]);
  });

  // each row is in the loans category by OSAMAKSU, so only the payee's name keeps it out
  it.each(["LÄHITAPIOLA", "FENNIA", "IF P&C INSURANCE LTD", "TURVA", "POHJOLA VAKUUTUS OY", "MANDATUM LIFE", "POHJANTÄHTI", "FOLKSAM", "ALANDIA", "EUROP ASSISTANCE"])("an insurer's instalments: %s", (counterparty) => {
    expect(proposalsOf(monthly(6, 62, { counterparty, description: "OSAMAKSU" }))).toEqual([]);
  });

  // LAINAOSUUS was a loan word before the housing company was asked, so the row is debt and only the payee keeps it out
  it.each(["AS OY KOTIKATU", "AS. OY KOTIKATU", "ASOY KOTIKATU", "ASUNTO OY KOTIKATU", "ASUNTO-OSAKEYHTIÖ KOTIKATU", "KIINTEISTÖ OY KOTIKATU", "KOY KOTIKATU", "BOSTADS AB HEMGATAN", "BOSTADSAKTIEBOLAGET HEMGATAN", "FASTIGHETS AB HEMGATAN"])(
    "a share of a housing company's loan: %s",
    (counterparty) => {
      expect(proposalsOf(monthly(6, 310, { counterparty, description: "LAINAOSUUS" }))).toEqual([]);
    },
  );

  it("a loan share paid to anyone else is proposed", () => {
    expect(proposalsOf(monthly(6, 310, { counterparty: "PEKKA VIRTANEN", description: "LAINAOSUUS" }))).toHaveLength(1);
  });

  it("a card bill is no loan when the card is connected either", () => {
    const bills = monthly(8, (i) => 400 + 37 * i, { counterparty: "NORDEA RAHOITUS SUOMI OY", description: "NORDEA GOLD LASKU" });
    expect(proposalsOf(bills, NO_INPUTS, [checking, gold])).toEqual([]);
  });

  it("the near misses beside a real loan leave the loan alone", () => {
    const rent = monthly(8, 1050, { counterparty: "SATO-ASUNNOT OY", description: "VUOKRA" });
    expect(proposalsOf([...pay, ...rent, ...carLoan()]).map((p) => p.payee)).toEqual(["Toyota Finance Finland"]);
  });
});

describe("what the household already answered", () => {
  const marked = (rows: Transaction[], from = rows): UserInputs => ({
    ...NO_INPUTS,
    marks: proposalsOf(from).map((p) => ({ ...notLoanMark(p), markedAt: "2026-10-10T09:00:00" })),
  });

  it("a series marked \"Ei laina\" is not proposed again, and taking the mark away brings the proposal back", () => {
    const rows = carLoan();
    const inputs = marked(rows);
    expect(inputs.marks).toEqual([{ subject: "loan-proposal:out:chk:Toyota Finance Finland#25000", mark: "dismissed", markedAt: "2026-10-10T09:00:00" }]);
    expect(proposalsOf(rows, inputs)).toEqual([]);
    expect(proposalsOf(rows, { ...inputs, marks: [] })).toHaveLength(1);
  });

  it("the mark holds when the payment has moved since, and when the lender got a second loan", () => {
    const first = mortgage(14, (i) => (i < 4 ? 600 : 600 + 12 * (i - 3)));
    const inputs = marked(first, first.slice(0, 4).map((t, i) => ({ ...t, bookingDate: `2026-${String(7 + i).padStart(2, "0")}-05` })));
    expect(inputs.marks.map((m) => m.subject)).toEqual(["loan-proposal:out:chk:Nordea Bank Abp#60000"]);
    expect(proposalsOf(first, inputs)).toEqual([]);
    const second = monthly(5, 180, { counterparty: "NORDEA BANK ABP", description: "LAINANLYHENNYS 7654321", day: 20 });
    expect(proposalsOf([...first, ...second], inputs).map((p) => p.paymentCents)).toEqual([18000]);
  });

  it("a mark on another series, of another kind, or made on Laskut hides nothing", () => {
    const at = { markedAt: "2026-10-10T09:00:00" };
    const others: UserInputs["marks"] = [
      { subject: "loan-proposal:out:chk:Santander#25000", mark: "dismissed", ...at },
      { subject: "loan-proposal:out:chk:Toyota Finance Finland#25000", mark: "in_use", ...at },
      { subject: "series:out:chk:Toyota Finance Finland#25000", mark: "dismissed", ...at },
      { subject: "series:out:chk:Toyota Finance Finland#25000", mark: "in_use", ...at },
      { subject: "merchant:Toyota Finance Finland", mark: "dismissed", ...at },
      { subject: "alert:forgotten:out:chk:Toyota Finance Finland", mark: "dismissed", ...at },
    ];
    for (const mark of others) expect(proposalsOf(carLoan(), { ...NO_INPUTS, marks: [mark] }), mark.subject).toHaveLength(1);
  });

  it("\"Ei laina\" has a subject of its own: a mark made on Laskut neither replaces it nor is replaced by it", () => {
    const rows = carLoan();
    const context = createContext(rows.map((t) => ({ ...t, category: "loans" })), [checking], TODAY);
    const series = context.recurring.find((s) => s.merchant === "Toyota Finance Finland")!;
    const [proposal] = loanProposals(context, NO_INPUTS);
    const answer = { ...notLoanMark(proposal!), markedAt: "2026-10-10T09:00:00" };
    // a fixed payment is a subscription to the marks of Laskut, whose subject carries the same key
    expect(seriesMarkSubject(series)).toBe(`series:${proposal!.key}`);
    expect(answer.subject).not.toBe(seriesMarkSubject(series));
    const inUse = { subject: seriesMarkSubject(series), mark: "in_use" as const, markedAt: "2026-10-12T09:00:00" };
    expect(loanProposals(context, { ...NO_INPUTS, marks: [answer, inUse] })).toEqual([]);
    // no reader of the marks of Laskut sees it
    expect(marksBySubject([answer]).size).toBe(0);
    expect(dismissedIds([answer]).size).toBe(0);
    expect(cancelledSubjects({ ...NO_INPUTS, marks: [answer] }).size).toBe(0);
  });

  it("the subject names a series key, which is what the marks route asks before it stores one", () => {
    expect(notLoanKey("loan-proposal:out:chk:Toyota Finance Finland#25000")).toBe("out:chk:Toyota Finance Finland#25000");
    for (const subject of ["series:out:chk:Toyota Finance Finland#25000", "loan-proposal:", "loan-proposal:Toyota Finance Finland", "loan-proposal:out::Toyota", "merchant:Toyota", "alert:loan-proposal:out:chk:Toyota"]) {
      expect(notLoanKey(subject), subject).toBeNull();
    }
  });

  it("a series linked to a saved loan is not proposed", () => {
    const rows = [...mortgage(), ...carLoan()];
    const key = proposalsOf(rows).find((p) => p.kind === "car")!.key;
    expect(proposalsOf(rows, { ...NO_INPUTS, loans: [savedLoan(key)] }).map((p) => p.payee)).toEqual(["Nordea Bank Abp"]);
  });

  it("a saved loan that is linked to nothing, or to another series, hides nothing", () => {
    expect(proposalsOf(carLoan(), { ...NO_INPUTS, loans: [savedLoan(null), savedLoan("out:chk:Santander#25000"), savedLoan("out:gold:Toyota Finance Finland#25000")] })).toHaveLength(1);
  });

  it("a link made with the bare series id covers the payee's series", () => {
    expect(proposalsOf(carLoan(), { ...NO_INPUTS, loans: [savedLoan("out:chk:Toyota Finance Finland")] })).toEqual([]);
  });

  it("a series marked as ended is not proposed", () => {
    const inputs: UserInputs = { ...NO_INPUTS, marks: [{ subject: "series:out:chk:Toyota Finance Finland#25000", mark: "cancelled", markedAt: "2026-10-10T09:00:00" }] };
    expect(proposalsOf(carLoan(), inputs)).toEqual([]);
  });
});
