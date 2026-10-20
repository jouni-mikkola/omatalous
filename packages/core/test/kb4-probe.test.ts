/**
 * Probe: persons in Muut menot, bank names that are no lender, and a finance company's steady payment. Every case has
 * its near miss. Rows go through the whole enrichment as the server stores them: a credit transfer carries the payee's
 * account and a reference field (null when the payment has none). Made-up names, accounts and sums only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import { addMonths } from "../src/dates.ts";
import { loanProposals } from "../src/loan-detect.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { type Account, type CategoryRule, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-15";
/** The user is Erkki Esimerkki: a payee of that name is the user's own and no other person. */
const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking", holder: "ESIMERKKI ERKKI" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
/** A savings account the household holds at Esimerkki Bank, connected. */
const atBank: Account = { id: "sav", name: "Säästötili", iban: "FI5512345600001234", currency: "EUR", type: "savings", bank: "Esimerkki Bank AB" };
const PERSON_IBAN = "FI4950009420028731";

type Extra = { date?: string; reference?: string | null; iban?: string | null; mcc?: string; bankTxnCode?: string; accountId?: string; user?: string };
/** A row as the server stores it: the reference is a field of its own (null: none), which the core type does not name. */
function row(counterparty: string | null, description: string | null, euros: number, x: Extra = {}): Transaction {
  const t = tx({
    accountId: x.accountId ?? "chk",
    bookingDate: x.date ?? "2026-09-12",
    amountCents: Math.round(euros * 100),
    counterparty,
    counterpartyIban: x.iban === undefined ? PERSON_IBAN : x.iban,
    description,
    mcc: x.mcc ?? null,
    bankTxnCode: x.bankTxnCode ?? null,
    merchant: normalizeMerchant(counterparty, description),
    ...(x.user ? { category: x.user, categorySource: "user" as const } : {}),
  });
  return { ...t, reference: x.reference === undefined ? null : x.reference } as Transaction;
}

function run(rows: Transaction[], opts: { rules?: CategoryRule[]; industries?: Map<string, string>; accounts?: Account[] } = {}) {
  const accounts = opts.accounts ?? [checking, card];
  const changed = new Map(enrichTransactions(rows, accounts, opts.rules ?? [], opts.industries).map((t) => [t.id, t]));
  const final = rows.map((t) => changed.get(t.id) ?? t);
  return { final, categories: final.map((t) => t.category), accounts };
}
const one = (counterparty: string | null, description: string | null, euros: number, x: Extra = {}) => run([row(counterparty, description, euros, x)]).categories[0]!;

/** One payment a month, the last in October 2026. */
const monthly = (count: number, euros: number, counterparty: string, description: string | null, x: Extra = {}) =>
  Array.from({ length: count }, (_, i) => row(counterparty, description, euros, { ...x, date: `${addMonths("2026-10", i - (count - 1))}-05` }));

/** The loan proposals and the front page's loan questions of the rows. */
function loanAsk(rows: Transaction[], accounts: Account[] = [checking, card]) {
  const { final } = run(rows, { accounts });
  const ctx = createContext(final, accounts, TODAY);
  const proposals = loanProposals(ctx, NO_INPUTS);
  const questions = buildQuestions(ctx, { from: "2026-01-01", to: TODAY }, NO_INPUTS, proposals).items.filter((i) => i.kind === "loan");
  return { proposals, questions, categories: final.map((t) => t.category) };
}

describe("a one-off or occasional transfer to a person is p2p", () => {
  it.each([
    ["VIRTANEN LIISA", null],
    ["KORHONEN ANNA MARIA", null],
    ["Liisa Virtanen", null],
    ["Anna Virtanen-Korhonen", null],
    ["VIRTANEN-KORHONEN ANNA", null],
    ["Liisa Virtanen", "Synttärilahja"],
    ["Liisa Virtanen", "Kiitos!"],
    // a person named like a bank: Pankki as a surname is no bank, and a person is no lender
    ["PANKKI PEKKA", null],
    ["Pekka Pankki", null],
    // the bank's word for a payment between people, as before
    ["Liisa Virtanen", "SIIRTO-MAKSU"],
  ])("money out to %s (%s) is p2p", (payee, message) => {
    expect(one(payee, message, -45)).toBe("p2p");
  });

  it.each([
    ["VIRTANEN LIISA", null],
    ["Liisa Virtanen", "Lounas"],
    ["Anna Virtanen-Korhonen", null],
    ["KORHONEN ANNA MARIA", "Kiitos"],
    ["Pekka Pankki", null],
  ])("money in from %s (%s) is p2p_in", (payee, message) => {
    expect(one(payee, message, 38.5)).toBe("p2p_in");
  });

  it("an occasional person, paid three different sums in three months, is p2p every time", () => {
    const rows = [row("VIRTANEN LIISA", null, -20, { date: "2026-07-03" }), row("VIRTANEN LIISA", null, -85, { date: "2026-08-19" }), row("VIRTANEN LIISA", null, -42.5, { date: "2026-09-27" })];
    expect(run(rows).categories).toEqual(["p2p", "p2p", "p2p"]);
  });

  it("a person paid the same sum month after month stays what it was (the people question asks), not p2p", () => {
    const { categories } = run(monthly(6, -150, "VIRTANEN LIISA", null));
    expect(categories.every((c) => c !== "p2p")).toBe(true);
  });

  it("the user's own name is no other person, either way", () => {
    expect(one("ESIMERKKI ERKKI", null, -300)).not.toBe("p2p");
    expect(one("Erkki Esimerkki", null, 300)).not.toBe("p2p_in");
  });

  // near misses: card evidence makes a purchase from a shop named like a person
  it.each<[string, string | null, Extra]>([
    ["PIKKU ILONA", null, { mcc: "5812", iban: null }],
    ["LIISA VIRTANEN", "12345678 HELSINKI", { iban: null }],
    ["LIISA VIRTANEN", null, { bankTxnCode: "PMNT-CCRD-POSD", iban: null }],
  ])("a card purchase at %s is no p2p", (payee, message, x) => {
    expect(one(payee, message, -18.9, x)).not.toBe("p2p");
  });
});

describe("a person's name with a purpose, a company form or a known company is no p2p", () => {
  it("a user's rule decides, both ways", () => {
    const rules: CategoryRule[] = [{ field: "counterparty", pattern: "VIRTANEN LIISA", category: "childcare", priority: 10 }];
    expect(run([row("VIRTANEN LIISA", null, -60)], { rules }).categories).toEqual(["childcare"]);
    expect(run([row("VIRTANEN LIISA", null, 60)], { rules: [{ ...rules[0]!, category: "reimbursements" }] }).categories).toEqual(["reimbursements"]);
  });

  it("a category the user set by hand stays", () => {
    expect(one("VIRTANEN LIISA", null, -60, { user: "hobbies" })).toBe("hobbies");
    expect(one("VIRTANEN LIISA", null, 60, { user: "income" })).toBe("income");
  });

  it.each([
    ["Liisa Virtanen", "VUOKRA LOKAKUU", "housing"],
    ["VIRTANEN LIISA", "Vuokra 10/2026", "housing"],
  ])("rent to %s (%s) is %s", (payee, message, category) => {
    expect(one(payee, message, -650)).toBe(category);
  });

  it.each([
    ["Liisa Virtanen", "LAINAN LYHENNYS"],
    ["Liisa Virtanen", "LAINA 2/10"],
    ["Liisa Virtanen", "LASKU 1234"],
    // brief: a text that names a purchase (adjust the word if the repo's purchase words differ)
    ["Liisa Virtanen", "POLKUPYÖRÄN OSTO"],
  ])("money out to %s with %s is no p2p", (payee, message) => {
    expect(one(payee, message, -120)).not.toBe("p2p");
  });

  it("a person's payment of a loan back to the household is no p2p_in either", () => {
    expect(one("Liisa Virtanen", "LAINAN LYHENNYS", 120)).not.toBe("p2p_in");
  });

  // a company named like a person, with each of the brief's forms, at an end or in front
  it.each([
    "VIRTANEN LIISA OY",
    "Liisa Virtanen Oy",
    "OY LIISA VIRTANEN",
    "VIRTANEN OYJ",
    "LIISA VIRTANEN AB",
    "LIISA VIRTANEN KY",
    "Liisa Virtanen Ay",
    "TMI LIISA VIRTANEN",
    "VIRTANEN LIISA TMI",
    "JOHN SMITH LTD",
    "HANS MULLER GMBH",
  ])("%s is a company: no p2p out, no p2p_in", (payee) => {
    expect(one(payee, null, -75)).not.toBe("p2p");
    expect(one(payee, null, 75)).not.toBe("p2p_in");
  });

  it("the lexicon's company named like a person is the company's category, not p2p", () => {
    expect(one("AMOS REX", null, -24)).not.toBe("p2p");
    expect(one("LAPUAN KANKURIT", null, -89)).not.toBe("p2p");
  });

  it("a register entry for a payee named like a person gives its industry, not p2p", () => {
    const merchant = normalizeMerchant("PIKKU ILONA", null);
    const { categories } = run([row("PIKKU ILONA", null, -32)], { industries: new Map([[merchant, "restaurants"]]) });
    expect(categories).toEqual(["restaurants"]);
  });

  it("near miss: a register entry for another merchant leaves the person p2p", () => {
    const { categories } = run([row("VIRTANEN LIISA", null, -32)], { industries: new Map([[normalizeMerchant("PIKKU ILONA", null), "restaurants"]]) });
    expect(categories).toEqual(["p2p"]);
  });
});

describe("a bank's name is no loan by itself", () => {
  it.each([
    "ESIMERKKI BANK",
    "ESIMERKKI PANKKI",
    "ESIMERKKI BANK GMBH",
    "ESIMERKKI BANK AB",
    "ESIMERKKI BANK ASA",
    "ESIMERKKI BANK AB (PUBL), SUOMEN SIVULIIKE",
  ])("money out to %s with a bare reference is other, not loans", (payee) => {
    expect(one(payee, "12345 67890", -99)).toBe("other");
    expect(one(payee, null, -99, { reference: "RF18 5390 0754 7034" })).toBe("other");
  });

  it.each([
    ["ESIMERKKI BANK AB", "LAINA 880123"],
    ["ESIMERKKI BANK AB", "LYHENNYS 9/2026"],
    ["ESIMERKKI BANK ASA", "LÅN 445566"],
    ["ESIMERKKI BANK GMBH", "LOAN 445566"],
    ["ESIMERKKI BANK AB", "KREDIT 445566"],
    ["ESIMERKKI PANKKI", "LUOTTO 445566"],
    ["ESIMERKKI BANK AB", "ERÄ 3/24"],
    ["ESIMERKKI BANK AB", "SOPIMUS 880123"],
  ])("%s with %s is loans", (payee, message) => {
    expect(one(payee, message, -99)).toBe("loans");
  });

  it("near miss: SOPIMUS without a number is no loan word", () => {
    expect(one("ESIMERKKI BANK AB", "SOPIMUS", -99)).not.toBe("loans");
  });

  it("a bank that paid the household credit out holds the payments after it, with no word, as loans", () => {
    const rows = [row("ESIMERKKI BANK AB", "LAINAN NOSTO 880123", 4000, { date: "2026-03-02" }), ...monthly(6, -152, "ESIMERKKI BANK AB", "880123")];
    expect(new Set(run(rows).categories.slice(1))).toEqual(new Set(["loans"]));
  });

  it("money out to the bank of a connected own account is transfer", () => {
    const { categories } = run([row("ESIMERKKI BANK AB", null, -500)], { accounts: [checking, card, atBank] });
    expect(categories).toEqual(["transfer"]);
  });

  it("near miss: the same payment with a loan word to that bank is loans", () => {
    const { categories } = run([row("ESIMERKKI BANK AB", "LAINAN LYHENNYS 880123", -500)], { accounts: [checking, card, atBank] });
    expect(categories).toEqual(["loans"]);
  });

  it("a card issuer named BANK keeps its card bill", () => {
    expect(one("BANK NORWEGIAN", "VIITE 12345 67890", -240)).toBe("card_bill");
  });

  it("a bank's name, a finance word and a form is still a lender", () => {
    expect(one("ESIMERKKI BANK RAHOITUS OY", "12345 67890", -99)).toBe("loans");
  });

  it("a restaurant called The Bank stays a restaurant", () => {
    expect(one("RAVINTOLA THE BANK OY", "HELSINKI", -42, { bankTxnCode: "PMNT-CCRD-POSD", iban: null })).toBe("restaurants");
  });
});

describe("a finance company's steady payment is a loan without the question", () => {
  const lenderSeries = (payee: string) => monthly(8, -189.5, payee, "SOPIMUS 7788123", { reference: "00000 77881 23006" });

  it.each(["ESIMERKKI RAHOITUS OY", "ESIMERKKIRAHOITUS OY", "ESIMERKKI FINANCE OY", "ESIMERKKI FINANS AB", "ESIMERKKI CREDIT LTD"])("a steady series to %s is loans, placed, and no question", (payee) => {
    const { proposals, questions, categories } = loanAsk(lenderSeries(payee));
    expect(new Set(categories)).toEqual(new Set(["loans"]));
    expect(questions).toEqual([]);
    for (const p of proposals) expect(p.placed).toBe(true);
  });

  it("a known lender of the list, steady, is placed too", () => {
    const { questions } = loanAsk(monthly(8, -95, "AVARDA AB", "SOPIMUS 4455667", { reference: "00000 44556 67001" }));
    expect(questions).toEqual([]);
  });

  it("near miss: a one-off to a finance company is loans with no proposal and no question", () => {
    const { proposals, questions, categories } = loanAsk([row("ESIMERKKI RAHOITUS OY", "SOPIMUS 7788123", -189.5, { reference: "00000 77881 23006" })]);
    expect(categories).toEqual(["loans"]);
    expect(proposals).toEqual([]);
    expect(questions).toEqual([]);
  });

  it("near miss: a steady loan to a bank (no lender's name) is still asked", () => {
    const { questions } = loanAsk(monthly(8, -320, "ESIMERKKI BANK AB", "LAINA 880123", { reference: "00000 88012 30001" }));
    expect(questions).toHaveLength(1);
  });

  it("near miss: a steady loan repaid to a person is still asked", () => {
    const { questions } = loanAsk(monthly(8, -200, "VIRTANEN LIISA", "LAINAN LYHENNYS"));
    expect(questions.length).toBeLessThanOrEqual(1);
    expect(loanAsk(monthly(8, -200, "VIRTANEN LIISA", "LAINAN LYHENNYS")).proposals.every((p) => !p.placed)).toBe(true);
  });

  it("near miss: a finance company paid unsteady sums is no placed loan", () => {
    const sums = [-40, -310, -95, -220, -18, -140];
    const rows = sums.map((euros, i) => row("ESIMERKKI RAHOITUS OY", "SOPIMUS 7788123", euros, { date: `${addMonths("2026-10", i - 5)}-05`, reference: "00000 77881 23006" }));
    expect(loanAsk(rows).proposals.filter((p) => p.placed)).toEqual([]);
  });
});

// Built against claude/sharp-edison-t55z1g at KB3 (62b5c14b); rows go through enrichTransactions, as the server stores them.
// Expected red until the task lands: incoming persons, Pankki as a surname, the register and lexicon over a person, KY/AY,
// bare bank names (the old bank-is-a-lender cases of categorize-bank-rows.test.ts flip), own-bank transfer, placed lenders.
