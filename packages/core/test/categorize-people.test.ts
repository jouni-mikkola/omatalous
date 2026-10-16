/**
 * People in the category rules: a co-holder's money, a person on a plain transfer, MobilePay booked as a card
 * purchase, and a purpose word with a number glued on. The co-holder's first name is a brand the phone rule knows,
 * which is the shape that went wrong: her money was read as a phone bill paid back.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { dataQualityReport } from "../src/analysis/data-quality.ts";
import { flowsOf, totalsOf } from "../src/analysis/flows.ts";
import { isEarnedIncome } from "../src/analysis/income.ts";
import { categorize, compileRules } from "../src/categorize.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { detectRecurring } from "../src/recurring.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const USER = "MEIKALAINEN MATTI";
const CO_HOLDER = "KORHONEN ELISA MARIA";
const joint: Account = { id: "joint", name: "Yhteinen tili", iban: "FI2112345600000785", currency: "EUR", type: "checking", holder: `${USER}, ${CO_HOLDER}` };
const own: Account = { id: "own", name: "Käyttötili", iban: "FI1410093000123458", currency: "EUR", type: "checking", holder: USER };
/** The user is known: one account in their name alone, one held with her. */
const HOUSEHOLD = [joint, own];
/** Every account held by both: no name is the user's alone. */
const BOTH_ON_ALL = [joint, { ...own, holder: `${CO_HOLDER}, ${USER}` }];

const builtin = compileRules([]);
/** `reference` left out: the row carries no such field, as the kit's and the demo's rows. `null`: it carries the field and the payment has none. */
type Extra = { mcc?: string; bankTxnCode?: string; reference?: string | null; counterpartyIban?: string | null };
const input = (counterparty: string | null, description: string | null, euros: number, extra: Extra = {}) => ({
  merchant: normalizeMerchant(counterparty, description),
  counterparty,
  description,
  mcc: extra.mcc ?? null,
  bankTxnCode: extra.bankTxnCode ?? null,
  amountCents: Math.round(euros * 100),
  ...(extra.reference === undefined ? {} : { reference: extra.reference }),
  ...(extra.counterpartyIban === undefined ? {} : { counterpartyIban: extra.counterpartyIban }),
});
const category = (counterparty: string | null, description: string | null, euros: number, extra: Extra = {}, accounts: readonly Account[] = HOUSEHOLD) =>
  categorize(input(counterparty, description, euros, extra), builtin, accounts).category;

/** The rows through the whole enrichment, with the month's flows. */
function month(rows: Transaction[], accounts: Account[]) {
  const changed = new Map(enrichTransactions(rows, accounts, []).map((t) => [t.id, t]));
  const final = rows.map((t) => changed.get(t.id) ?? t);
  const flows = final.map((t) => flowsOf(t, new Set()));
  return { final, flows, totals: totalsOf(flows) };
}
const row = (accountId: string, euros: number, counterparty: string | null, description: string, counterpartyIban: string | null = null) =>
  tx({ accountId, bookingDate: "2026-09-05", counterpartyIban, ...input(counterparty, description, euros) });

describe("a co-holder's own transfer", () => {
  it("into the joint account is money from a person, and nothing of the user's savings was drawn", () => {
    const { final, totals } = month([row("joint", 2500, CO_HOLDER, "Oma siirto")], HOUSEHOLD);
    expect(final[0]!.category).toBe("p2p_in");
    expect(totals).toMatchObject({ savedCents: 0, incomeCents: 250_000 });
  });

  it("is told by the bank's code too, and by a name written the other way round or without the middle name", () => {
    expect(category(CO_HOLDER, "Tilisiirto", 2500, { bankTxnCode: "PMNT-RCCN-COAT" })).toBe("p2p_in");
    expect(category("Elisa Maria Korhonen", "Oma siirto", 2500)).toBe("p2p_in");
    expect(category("ELISA KORHONEN", "Oma siirto", 2500)).toBe("p2p_in");
  });

  it("stays savings when every account has both holders, and when no account has a holder", () => {
    const { final, totals } = month([row("joint", 2500, CO_HOLDER, "Oma siirto")], BOTH_ON_ALL);
    expect(final[0]!.category).toBe("savings");
    expect(totals.savedCents).toBe(-250_000);
    expect(category(CO_HOLDER, "Oma siirto", 2500, {}, [{ ...joint, holder: null }, { ...own, holder: "" }])).toBe("savings");
    expect(category(CO_HOLDER, "Oma siirto", 2500, {}, [])).toBe("savings");
  });

  it("the user's own transfer in, one with no sender and every own transfer out stay savings", () => {
    expect(category("Matti Meikäläinen", "Oma siirto", 2500)).toBe("savings");
    expect(category(null, "Oma siirto", 2500)).toBe("savings");
    expect(category(null, "Tilisiirto", 2500, { bankTxnCode: "PMNT-RCCN-COAT" })).toBe("savings");
    expect(category(CO_HOLDER, "Oma siirto", -2500)).toBe("savings");
    // a third person is nobody's co-holder: the bank's words stand
    expect(category("VIRTANEN LIISA", "Oma siirto", 2500)).toBe("savings");
    // and her company is a company
    expect(category("ELISA KORHONEN OY", "Oma siirto", 2500)).toBe("savings");
  });

  it("between two connected accounts is still a transfer, whoever made it", () => {
    const second: Account = { ...joint, id: "joint-2", name: "Yhteinen säästötili", iban: "FI5512345600000123", type: "savings" };
    const { final, totals } = month([row("joint", -500, CO_HOLDER, "Oma siirto", second.iban), row("joint-2", 500, CO_HOLDER, "Oma siirto", joint.iban)], [...HOUSEHOLD, second]);
    expect(final.map((t) => t.isTransfer)).toEqual([true, true]);
    expect(totals.incomeCents).toBe(0);
  });
});

describe("money to and from a co-holder", () => {
  it("with a shop word in the message is money from a person, and the phone bills stay what they were", () => {
    const { final, totals } = month([row("own", -19.9, "ELISA OYJ", "E-LASKU"), row("own", 140, CO_HOLDER, "kauppa")], HOUSEHOLD);
    expect(final.map((t) => t.category)).toEqual(["telecom", "p2p_in"]);
    expect(totals).toMatchObject({ consumptionCents: 1990, incomeCents: 14_000 });
    // without the holders her first name is the phone company's
    expect(category(CO_HOLDER, "kauppa", 140, {}, [])).toBe("telecom");
  });

  it("a word of a purpose in her message is no pay, rent income or loan of the user's", () => {
    expect(category(CO_HOLDER, "vuokra", 400)).toBe("p2p_in");
    expect(category(CO_HOLDER, "lainan lyhennys", 200)).toBe("p2p_in");
  });

  it("paid to her is a payment to a person, and rent paid to her is rent", () => {
    expect(category(CO_HOLDER, "ruokaostokset", -50)).toBe("p2p");
    expect(category(CO_HOLDER, "vuokra", -400)).toBe("housing");
  });

  it("is told with a child's account connected too: the user is the one name on the most accounts, and a tie knows nobody", () => {
    const child: Account = { id: "child", name: "Villen tili", iban: "FI5512345600000123", currency: "EUR", type: "checking", holder: "MEIKALAINEN VILLE" };
    expect(category(CO_HOLDER, "kauppa", 140, {}, [...HOUSEHOLD, child])).toBe("p2p_in");
    expect(category(CO_HOLDER, "kauppa", 140, {}, [...HOUSEHOLD, { ...own, id: "hers", holder: CO_HOLDER }])).toBe("telecom");
  });
});

describe("MobilePay booked as a card purchase", () => {
  const TERMINAL = "12345678 HELSINKI";

  it("with a person's name behind the prefix is a payment to a person", () => {
    expect(category("MOB.PAY*ELISA MARIA KORHO", TERMINAL, -50, {}, [])).toBe("p2p");
    expect(category("MOB PAY *MATTI JUHANI MEIKAL", TERMINAL, -20, { mcc: "4829" }, [])).toBe("p2p");
  });

  it("with a business behind it stays a shop", () => {
    expect(category("MOB.PAY*KAHVILA ILO OY", TERMINAL, -12, {}, [])).toBe("restaurants");
    expect(category("MOB.PAY*KAHVILA ILO", TERMINAL, -12, {}, [])).toBe("restaurants");
    // two brand words have the shape of a name: the card's code says it is a shop
    expect(category("MOB.PAY*TALLINK SILJA", TERMINAL, -89, { mcc: "4411" }, [])).toBe("travel");
    // a text with no payee field ends in the terminal's code and town, so no name can be read from it
    expect(category(null, "MOB.PAY*STORYTEL OY 7Q2K9X HELSINKI", -24.99, {}, [])).toBe("subscriptions");
  });
});

describe("a person on a plain transfer", () => {
  it("with the bank's word for a phone payment is money from a person and not earned", () => {
    const { final, flows } = month([row("own", 50, "MEIKALAINEN MAIJA", "Mobiilimaksu")], HOUSEHOLD);
    expect(final[0]!.category).toBe("p2p_in");
    expect(isEarnedIncome({ ...final[0]!, flows: flows[0]! })).toBe(false);
    expect(category("MAIJA MEIKÄLÄINEN", "Siirto-maksu", 50, {}, [])).toBe("p2p_in");
    expect(category("KORHONEN ELISA", "SIIRTO-MAKSU", -35, {}, [])).toBe("p2p");
  });

  it("named without that word is left as it was when the row carries no reference field at all", () => {
    expect(category("MEIKALAINEN MAIJA", "kiitos", 50, {}, [])).toBe("income");
    expect(category("MEIKALAINEN MAIJA", "kiitos", -50, {}, [])).toBe("other");
  });

  it.each([
    ["a private landlord paid with a reference stays rent", "VIRTANEN PEKKA", "VUOKRA 4471", -850, {}, "housing"],
    ["and so does one paid with the bank's phone payment", "VIRTANEN PEKKA", "Siirto-maksu vuokra", -850, {}, "housing"],
    ["pay with the salary code from an employer named like a person stays pay", "MEIKALAINEN MAIJA", "Mobiilimaksu", 2100, { bankTxnCode: "PMNT-RCDT-SALA" }, "salary"],
    ["pay by its word too", "MEIKALAINEN MAIJA", "Palkka Siirto-maksu", 2100, {}, "salary"],
    ["a sole trader by the company form is a business", "TMI MATTI MEIKALAINEN", "Mobiilimaksu", -120, {}, "other"],
    ["a name with a trade word is a business", "KAHVILA MEIKALAINEN", "Mobiilimaksu", -32, {}, "restaurants"],
    ["a card purchase at a shop named like a person is a shop's", "MEIKALAINEN MAIJA", "Mobiilimaksu", -20, { bankTxnCode: "PMNT-CCRD-POSD" }, "other"],
  ] as const)("%s", (_name, counterparty, description, euros, extra, expected) => {
    expect(category(counterparty, description, euros, extra)).toBe(expected);
  });

  it("a user's rule wins over all of it", () => {
    const rules = compileRules([{ field: "counterparty", pattern: "Korhonen Elisa", category: "groceries", priority: 10 }]);
    for (const [description, euros] of [["Oma siirto", 2500], ["kauppa", -140], ["Mobiilimaksu", -20]] as const) {
      expect(categorize(input(CO_HOLDER, description, euros), rules, HOUSEHOLD), description).toMatchObject({ category: "groceries", byUser: true });
    }
    expect(categorize(input("MOB.PAY*ELISA MARIA KORHO", "12345678 HELSINKI", -50), compileRules([{ field: "any", pattern: "Elisa Maria", category: "gifts_donations", priority: 10 }]), HOUSEHOLD).category).toBe("gifts_donations");
  });
});

/** A credit transfer has the payee's account. */
const PAYEE_ACCOUNT = "FI4950009420028731";

describe("a payment to a person's account with no reference number", () => {
  const none = { reference: null, counterpartyIban: PAYEE_ACCOUNT };

  it.each([
    ["is a payment between people, whatever brand the payee's name is also", "HELEN VIRTA", "SYNTTARILAHJA", -40, none, "p2p"],
    ["an allowance is one", "VIRTANEN LIISA", "TASKURAHA", -20, none, "p2p"],
    ["an empty reference is none", "MEIKALAINEN MAIJA", "kiitos", -50, { ...none, reference: "" }, "p2p"],
    ["and so is a blank one", "MEIKALAINEN MAIJA", "kiitos", -50, { ...none, reference: "  " }, "p2p"],
    ["with a reference number it may be a sole trader's invoice, and the rules read it as before", "MEIKALAINEN MAIJA", "kiitos", -50, { ...none, reference: "4471" }, "other"],
  ] as const)("%s", (_name, counterparty, description, euros, extra, expected) => {
    expect(category(counterparty, description, euros, extra)).toBe(expected);
    expect(category(counterparty, description, euros, extra, [])).toBe(expected);
  });

  it.each([
    ["the same row with no account of the payee", "HELEN VIRTA", "SYNTTARILAHJA", -40, { reference: null }, "utilities"],
    ["and with an empty account", "HELEN VIRTA", "SYNTTARILAHJA", -40, { reference: null, counterpartyIban: "" }, "utilities"],
    ["a shop named with one brand word and a town, no code, no card code and no text, no account", "LIDL TIKKURILA", null, -44.15, { reference: null }, "groceries"],
    ["and with the card's own text", "LIDL TIKKURILA", "KORTTIOSTO", -44.15, { reference: null }, "groceries"],
    ["and the card's own text on a row with an account", "LIDL TIKKURILA", "KORTTIOSTO", -44.15, none, "groceries"],
  ] as const)("%s is read as before", (_name, counterparty, description, euros, extra, expected) => {
    expect(category(counterparty, description, euros, extra)).toBe(expected);
    expect(category(counterparty, description, euros, extra, [])).toBe(expected);
  });

  it.each([
    ["a sole trader's invoice", "MEIKALAINEN MATTI", "LASKU 12 REMONTTI", -950, "home"],
    ["daycare paid to a person", "VIRTANEN LIISA", "PAIVAHOITO MAALISKUU", -300, "kids"],
    ["a physiotherapist", "NIEMINEN ANNA", "FYSIOTERAPIA", -60, "health"],
    ["a cleaner", "NIEMINEN TUULA", "SIIVOUS", -80, "home"],
    ["a florist named like a person", "KUKKA ILO", "KIMPPU", -35, "home"],
    ["a landlord with the word for rent", "VIRTANEN PEKKA", "VUOKRA 4471", -850, "housing"],
    ["an invoice word alone", "VIRTANEN LIISA", "INVOICE 4471", -50, "other"],
    ["a reference written only in the text", "MEIKALAINEN MAIJA", "RF18 1234 5678", -50, "other"],
    ["and a long run of digits", "MEIKALAINEN MAIJA", "viite 1234567", -50, "other"],
  ] as const)("%s stays what the rules say", (_name, counterparty, description, euros, expected) => {
    expect(category(counterparty, description, euros, none)).toBe(expected);
    expect(category(counterparty, description, euros, none, [])).toBe(expected);
  });

  it("is the payee's alone: a company, a card purchase and money in are not read this way", () => {
    expect(category("MEIKALAINEN MAIJA", "kiitos", -50, { reference: null })).toBe("other");
    expect(category("TMI MATTI MEIKALAINEN", "kiitos", -120, none)).toBe("other");
    expect(category("MEIKALAINEN MAIJA", "kiitos", -20, { ...none, bankTxnCode: "PMNT-CCRD-POSD" })).toBe("other");
    // pay and rent from a person carry no reference either, and must stay earned: only money out is built
    expect(category("MEIKALAINEN MAIJA", "kiitos", 50, none)).toBe("income");
    expect(category("MEIKALAINEN MAIJA", "TUNNIT VKO 12", 600, none)).toBe("income");
  });
});

describe("what a message may say and the payment stays between people", () => {
  const none = { reference: null, counterpartyIban: PAYEE_ACCOUNT };

  it.each([
    "lasku 12",
    "LASKU12",
    "laskunumero 1023",
    "laskunro 1023",
    "laskun nro 1023",
    "laskutus 3/2026",
    "faktura 12",
    "inv 1023",
    "INVOICE 1023",
  ])("the invoice wording %j steps aside: a sole trader's invoice, read as before", (message) => {
    expect(category("MEIKALAINEN MAIJA", message, -50, none)).toBe("other");
  });

  it.each(["viite 10016", "viitenumero 1232", "viite 12345 67890", "12345 67890 12345", "123456", "RF18 1234 5678"])("the reference wording %j steps aside: read as before", (message) => {
    expect(category("MEIKALAINEN MAIJA", message, -50, none)).toBe("other");
  });

  it.each(["kiitos", "invitation", "laskin", "kiitos 12345", "kahvit 5 euroa", "huone 12 3", "viittaus"])("%j is nothing of the kind: a payment between people", (message) => {
    expect(category("MEIKALAINEN MAIJA", message, -50, none)).toBe("p2p");
  });
});

describe("a payment to a payee the account pays the same sum every month", () => {
  const PAYEE = "VIRTANEN PEKKA";
  const TODAY = "2026-09-20";
  /** The 5th of each month from April to September unless the months are given. */
  const payments = (accountId: string, euros: number, message: string | null, months = [4, 5, 6, 7, 8, 9], payee = PAYEE) =>
    months.map((m) => tx({ accountId, bookingDate: `2026-${String(m).padStart(2, "0")}-05`, ...input(payee, message, euros, { reference: null, counterpartyIban: PAYEE_ACCOUNT }) }));
  const rows = (rent: Transaction[]) => {
    const { final } = month(rent, HOUSEHOLD);
    return { final, series: detectRecurring(final, TODAY), hint: dataQualityReport(createContext(final, HOUSEHOLD, TODAY), { from: "2026-04-01", to: "2026-09-30" }).signals.find((s) => s.id === "uncategorised") };
  };

  it.each([[null], ["Meikalainen huhtikuu"], ["Esimerkkikatu 5 A 12"], ["hyra april"], ["rent april"]])("with the message %j is read as before: not sorted, a series in Toistuvat, named in the hint", (message) => {
    const { final, series, hint } = rows(payments("own", -850, message));
    expect(final.map((t) => [t.category, t.categorySource])).toEqual(Array(6).fill(["other", "default"]));
    expect(series.map((s) => [s.merchant, s.category, s.occurrences, s.typicalAmountCents])).toEqual([[normalizeMerchant(PAYEE, null), "other", 6, 85_000]]);
    expect(hint?.detail).toContain(normalizeMerchant(PAYEE, null));
  });

  it("the sums need not be equal: within a tenth of their median is steady", () => {
    const rent = payments("own", -850, null).map((t, i) => ({ ...t, amountCents: t.amountCents + (i % 2 ? -4000 : 4000) }));
    expect(rows(rent).final.map((t) => t.category)).toEqual(Array(6).fill("other"));
  });

  it("a payee seen in only two months is not steady yet, and is a payment between people", () => {
    const { final, series, hint } = rows(payments("own", -850, null, [8, 9]));
    expect(final.map((t) => t.category)).toEqual(["p2p", "p2p"]);
    expect(series).toEqual([]);
    expect(hint).toBeUndefined();
  });

  it("three payments in one month, or three months of sums far apart, are no steady payee", () => {
    expect(rows(payments("own", -850, null, [9, 9, 9])).final.map((t) => t.category)).toEqual(["p2p", "p2p", "p2p"]);
    const apart = payments("own", -850, null, [7, 8, 9]).map((t, i) => ({ ...t, amountCents: -[30_000, 85_000, 12_000][i]! }));
    expect(rows(apart).final.map((t) => t.category)).toEqual(["p2p", "p2p", "p2p"]);
  });

  it("is steady on the account that pays: the same payee paid from another account is a gift there", () => {
    const { final } = rows([...payments("joint", -850, null), ...payments("own", -850, null, [9]).map((t) => ({ ...t, id: "single" }))]);
    expect(final.filter((t) => t.accountId === "joint").map((t) => t.category)).toEqual(Array(6).fill("other"));
    expect(final.find((t) => t.id === "single")!.category).toBe("p2p");
  });

  it("money in from the same person is income whatever the history", () => {
    const { final } = rows(payments("own", 850, null));
    expect(final.map((t) => t.category)).toEqual(Array(6).fill("income"));
  });

  it("a single gift, a share of a bill and money paid back stay payments between people", () => {
    const single = (payee: string, message: string, euros: number) => rows(payments("own", euros, message, [9], payee)).final[0]!.category;
    expect(single("VIRTANEN PEKKA", "synttarilahja", -40)).toBe("p2p");
    expect(single("VIRTANEN LIISA", "osuus illasta", -24.5)).toBe("p2p");
    expect(single("VIRTANEN LIISA", "maksan takaisin", -60)).toBe("p2p");
  });
});

describe("a payment to the user's own name", () => {
  const none = { reference: null, counterpartyIban: PAYEE_ACCOUNT };

  it.each([
    ["the name as the bank writes it", USER, "siirto"],
    ["and written the other way round with a middle name", "Matti Juhani Meikäläinen", "siirto"],
    ["with the words of someone moving money to the savings", USER, "rahaa S-pankkiin"],
    ["and with no message at all", USER, null],
  ] as const)("%s is no other person's: read as before", (_name, payee, message) => {
    expect(category(payee, message, -500, none)).toBe("other");
    const { final } = month([tx({ accountId: "own", bookingDate: "2026-09-05", ...input(payee, message, -500, none) })], HOUSEHOLD);
    expect(final[0]!.category).toBe("other");
  });

  it("while the user is not known, or the payee is another person, it is a payment between people", () => {
    expect(category(USER, "siirto", -500, none, [])).toBe("p2p");
    expect(category(USER, "siirto", -500, none, BOTH_ON_ALL)).toBe("p2p");
    expect(category(CO_HOLDER, "siirto", -500, none)).toBe("p2p");
    expect(category("MEIKALAINEN MAIJA", "siirto", -500, none)).toBe("p2p");
    // a first name alone is nobody's whole name
    expect(category("Matti", "siirto", -500, none)).toBe("other");
  });

  it("with the bank's words for an own transfer stays savings, as before", () => {
    expect(category(USER, "Oma siirto", -500, none)).toBe("savings");
    expect(category(USER, "säästöön", -500, none)).toBe("savings");
  });
});

describe("one name told from another", () => {
  it("a payer who gives a first name only is nobody's co-holder: her first name is the phone company's", () => {
    expect(category("Elisa", "kauppa", 140)).toBe("telecom");
    expect(category(CO_HOLDER, "kauppa", 140)).toBe("p2p_in");
  });
});

describe("a purpose word with a number glued on", () => {
  it("a travel claim from an employer is a reimbursement, also in the payroll batch", () => {
    expect(category("TYONANTAJA OY", "Matkalasku123456", 800)).toBe("reimbursements");
    expect(category("TYONANTAJA OY", "Matkalasku123456", 800, { bankTxnCode: "PMNT-RCDT-SALA" })).toBe("reimbursements");
    expect(category("TYONANTAJA OY", "KULUKORVAUS2026-09", 64)).toBe("reimbursements");
  });

  it("a longer word is another word, and pay with the code stays pay", () => {
    expect(category("TYONANTAJA OY", "Matkalaskutus", 800)).toBe("income");
    expect(category("TYONANTAJA OY", "Matkalaskutus", 800, { bankTxnCode: "PMNT-RCDT-SALA" })).toBe("salary");
  });
});
