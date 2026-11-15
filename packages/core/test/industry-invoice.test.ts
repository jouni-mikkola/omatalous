/**
 * An invoice's payee and the trade register. A payment to an account with a reference number is an invoice, and its
 * payee may be asked about only when the guard takes it for no person: not by the shape of the name, not by a word it
 * shares with a name the household has, and not as a name that says nothing of business (one bare word, a sign in a
 * word) when nothing else vouches for it. Every name here is made up.
 */
import { describe, expect, it } from "vitest";
import { householdWords, industryCandidates, isBusinessRow, namesHousehold } from "../src/industry.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const base = { currency: "EUR", type: "checking" } as const;
/** The household: one account each, a joint account, a card. The bank names the holders. */
const own: Account = { ...base, id: "chk", name: "Käyttötili", iban: "FI2112345600000785", holder: "MEIKALAINEN MATTI" };
const joint: Account = { ...base, id: "joint", name: "Yhteinen tili", iban: "FI2112345600000786", holder: "MEIKALAINEN MATTI, KORHONEN ELISA MARIA" };
const card: Account = { ...base, id: "card", name: "Luottokortti", iban: null, type: "credit_card", holder: "MEIKALAINEN MATTI" };
const ACCOUNTS = [own, joint, card];
/** What the members are shown as: the server tells these. */
const MEMBERS = householdWords(["Matti", "Elisa"]);
/** The same accounts as a bank gives them before it has named a holder. */
const UNNAMED = ACCOUNTS.map((account) => ({ ...account, holder: null }));

const IBAN = "FI4950009420028731";
type Fields = Partial<Transaction>;
const INVOICE: Fields = { counterpartyIban: IBAN, reference: "1234561" };
const CARD: Fields = { accountId: "card" };
const TERMINAL: Fields = { description: "483920 HELSINKI" };
/** Every way a row can say it pays a business. */
const EVIDENCE: Record<string, Fields> = { invoice: INVOICE, "a card account": CARD, "a merchant code": { mcc: "5999" }, "a card terminal's text": TERMINAL, "e-invoice text": { counterpartyIban: IBAN, description: "E-LASKU 4471" } };

/** A row as ingest stores it: the merchant is made from the bank's own texts. */
const row = (counterparty: string | null, fields: Fields = {}): Transaction =>
  tx({ accountId: "chk", bookingDate: "2026-09-01", amountCents: -2500, counterparty, merchant: normalizeMerchant(counterparty, fields.description ?? null), ...fields });
/** An outgoing transfer with a payee account, already sorted: the ledger delivers payee accounts. */
const rent = () =>
  tx({ accountId: "chk", bookingDate: "2026-09-02", amountCents: -70000, merchant: "Vuokranantaja", counterparty: "VUOKRANANTAJA", counterpartyIban: "FI4950009420028732", category: "housing", categorySource: "rule" });

/** What the household's lookup would send for these rows. */
const asked = (...rows: Transaction[]) => industryCandidates([rent(), ...rows], ACCOUNTS, MEMBERS);
/** The same for a household nobody has named: no holder, no member's name. */
const askedUnnamed = (...rows: Transaction[]) => industryCandidates([rent(), ...rows], UNNAMED);
const NO_CARDS: ReadonlySet<string> = new Set();

describe("an invoice's payee: a payee account, a reference number and a payee field", () => {
  it("is a business's when the name says so, and is asked about", () => {
    const invoice = () => row("ESIMERKKI HUOLTO", INVOICE);
    expect(isBusinessRow(invoice(), NO_CARDS)).toBe(true);
    expect(asked(invoice(), invoice())).toEqual(["Esimerkki Huolto"]);
    // the register's answer is used on it
    const paid = invoice();
    const [sorted] = enrichTransactions([paid], ACCOUNTS, [], new Map([[paid.merchant, "car"]]));
    expect(sorted).toMatchObject({ category: "car", categorySource: "industry" });
  });

  it("is a person's by the shape of the name: neither a business row nor asked about, and sorted as before", () => {
    const person = () => row("VIRTANEN LIISA", INVOICE);
    expect(isBusinessRow(person(), NO_CARDS)).toBe(false);
    expect(asked(person(), person())).toEqual([]);
    // an answer the register gave for the same name changes nothing on the row
    const before = enrichTransactions([person()], ACCOUNTS, []).map((t) => t.category);
    const paid = person();
    const after = enrichTransactions([paid], ACCOUNTS, [], new Map([[paid.merchant, "car"]])).map((t) => t.category);
    expect(after).toEqual(before);
    expect(after).not.toContain("car");
  });

  it("is a person's when a brand rule makes a shop of the surname", () => {
    const person = (fields: Fields) => row("MAX VIRTANEN", fields);
    // the merchant is the brand, one word that a card row would vouch for: the bank's own text still names a person
    expect(person(INVOICE).merchant).toBe("Max");
    for (const [kind, fields] of Object.entries(EVIDENCE)) expect(asked(person(fields)), kind).toEqual([]);
    expect(asked(person(INVOICE), row("MAX", CARD))).toEqual([]);
    expect(isBusinessRow(person(INVOICE), NO_CARDS, new Set(["Max"]))).toBe(false);
  });

  it("is a person's when the surname is a word the category rules know as a brand", () => {
    // "Virta" charges cars: the rules may sort the row, the register is not asked about the person
    for (const payee of ["VIRTA MATTI", "VIRTA PEKKA", "PEKKA VIRTA"]) {
      for (const [kind, fields] of Object.entries(EVIDENCE)) expect(asked(row(payee, fields)), `${payee}, ${kind}`).toEqual([]);
      expect(isBusinessRow(row(payee, INVOICE), NO_CARDS), payee).toBe(false);
    }
  });

  it("is nobody's when the payee field holds no letter: the name is then the payer's own message", () => {
    const numbered = row("123", { ...INVOICE, description: "AUTOLIIKE ESIMERKKI" });
    expect(numbered.merchant).toBe("Autoliike Esimerkki");
    expect(isBusinessRow(numbered, NO_CARDS)).toBe(false);
    expect(asked(numbered)).toEqual([]);
    expect(asked(row("AUTOLIIKE ESIMERKKI", INVOICE))).toEqual(["Autoliike Esimerkki"]);
  });

  it("is nobody's when the name is written with a sign: a company's and a couple's look the same", () => {
    // the shape cannot tell "A&B ESIMERKKI" from "L&P VIRTANEN", and a person's name must not leave on a guess
    const written = [
      "A&B ESIMERKKI",
      "ESIMERKKI.FI VERKKO",
      "VIRTANEN LIISA&PEKKA",
      "LIISA&PEKKA VIRTANEN",
      "L&P VIRTANEN",
      "VIRTANEN LIISA+PEKKA",
      "liisa.virtanen@esimerkki.fi",
      "'T VIRTANEN LIISA",
      "LIISA & PEKKA VIRTANEN",
    ];
    for (const payee of written) {
      expect(isBusinessRow(row(payee, INVOICE), NO_CARDS), payee).toBe(false);
      expect(asked(row(payee, INVOICE), row(payee, INVOICE)), payee).toEqual([]);
      // sorted as before: an answer the register gave for the name changes nothing on the row
      const paid = row(payee, INVOICE);
      const sorted = enrichTransactions([paid], ACCOUNTS, [], new Map([[paid.merchant, "car"]]));
      expect(sorted.map((t) => t.categorySource), payee).not.toContain("industry");
    }
  });

  it("is a company's when a shop of that name is also paid by another kind of row", () => {
    for (const [payee, merchant] of [
      ["A&B ESIMERKKI", "A&b Esimerkki"],
      ["ESIMERKKI.FI VERKKO", "Esimerkki.Fi Verkko"],
    ] as const) {
      expect(isBusinessRow(row(payee, INVOICE), NO_CARDS, new Set([merchant])), payee).toBe(true);
      for (const [kind, fields] of Object.entries(EVIDENCE)) {
        if (fields !== INVOICE) expect(asked(row(payee, INVOICE), row(payee, fields)), `${payee}, ${kind}`).toEqual([merchant]);
      }
    }
  });
});

describe("one bare word with a reference number: a surname alone looks the same", () => {
  it("is not asked about when nothing else vouches for it", () => {
    for (const payee of ["ZORRO", "VIRTANEN", "ESIMERKKI.FI", "ZORRO 24"]) {
      expect(isBusinessRow(row(payee, INVOICE), NO_CARDS), payee).toBe(false);
      expect(asked(row(payee, INVOICE), row(payee, INVOICE)), payee).toEqual([]);
    }
    // a plain transfer to the same name vouches for nothing, and rules the name out
    expect(asked(row("ZORRO", INVOICE), row("ZORRO", { counterpartyIban: IBAN }))).toEqual([]);
  });

  it("is asked about when another row of the merchant has business evidence of another kind", () => {
    for (const [kind, fields] of Object.entries(EVIDENCE)) {
      if (fields === INVOICE) continue;
      expect(asked(row("ZORRO", INVOICE), row("ZORRO", fields)), kind).toEqual(["Zorro"]);
    }
    // where the rows are sorted, a shop the household pays by card vouches for its invoice
    expect(isBusinessRow(row("ZORRO", INVOICE), NO_CARDS, new Set(["Zorro"]))).toBe(true);
    expect(isBusinessRow(row("ZORRO", INVOICE), NO_CARDS, new Set(["Lyhtypuoti"]))).toBe(false);
  });

  it("a business word in the word is enough, as before", () => {
    expect(asked(row("PIKKUPUOTI", INVOICE))).toEqual(["Pikkupuoti"]);
  });

  it("another row vouches for a business word beside two names too, as a card row alone does", () => {
    const named = "LANKAPUOTI PEKKA ESIMERKKI";
    expect(asked(row(named, INVOICE))).toEqual([]);
    expect(asked(row(named, CARD))).toEqual(["Lankapuoti Pekka Esimerkki"]);
    expect(asked(row(named, INVOICE), row(named, CARD))).toEqual(["Lankapuoti Pekka Esimerkki"]);
  });
});

describe("the household's own names are never asked about, whatever the row says", () => {
  /** Each with every kind of evidence, and with an invoice beside a card row. */
  const never = (payee: string) => {
    for (const [kind, fields] of Object.entries(EVIDENCE)) expect(asked(row(payee, fields), row(payee, fields)), `${payee}, ${kind}`).toEqual([]);
    expect(asked(row(payee, INVOICE), row(payee, CARD)), `${payee}, an invoice and a card row`).toEqual([]);
  };

  it("a relative: the surname of a holder, in a name that says it is a business", () => {
    for (const payee of ["MEIKALAINEN PEKKA", "TMI PEKKA MEIKÄLÄINEN", "MEIKÄLÄINEN PEKKA OY", "PEKKA MEIKÄLÄINEN KULJETUS", "KULJETUS MEIKÄLÄINEN", "MEIKÄLÄINEN", "Meikäläinen & Pojat Oy"]) never(payee);
    // the same names are asked about by a household that the bank has not named, on a card row
    expect(askedUnnamed(row("TMI PEKKA MEIKÄLÄINEN", CARD))).toEqual(["Tmi Pekka Meikäläinen"]);
    expect(askedUnnamed(row("MEIKÄLÄINEN", CARD))).toEqual(["Meikäläinen"]);
  });

  it("a member's first name alone, which may be a brand, and the other holder of a joint account", () => {
    for (const payee of ["ELISA", "ELISA OYJ", "ELISA KUKKAKAUPPA", "KORHONEN", "KORHONEN KONSULTOINTI", "MARIA SHOP", "MATTI HUOLTO OY"]) never(payee);
    // "Elisa" is a brand to the merchant rules, so the merchant of all three is the one word
    expect(row("ELISA KUKKAKAUPPA", INVOICE).merchant).toBe("Elisa");
    expect(askedUnnamed(row("KORHONEN KONSULTOINTI", INVOICE))).toEqual(["Korhonen Konsultointi"]);
  });

  it("a member's display name counts when no account names a holder", () => {
    const rows = () => [rent(), row("ELISA", CARD), row("LANKAPUOTI ILO", CARD)];
    expect(industryCandidates(rows(), UNNAMED)).toEqual(["Elisa", "Lankapuoti Ilo"]);
    expect(industryCandidates(rows(), UNNAMED, householdWords(["Elisa"]))).toEqual(["Lankapuoti Ilo"]);
  });

  it("a name the bank cut, two names written together, a double surname, a digit or a dot glued on", () => {
    for (const payee of ["TMI PEKKA MEIKALAI", "PEKKAMEIKALAINEN", "MATTIMEIKÄLÄINEN OY", "KORHONEN-VIRTANEN KULJETUS", "MEIKÄLÄINEN2 OY", "M.MEIKÄLÄINEN OY", "ELISAN KUKKAKAUPPA"]) never(payee);
  });

  it("a card account's spelling of the name: AE for Ä, OE for Ö", () => {
    never("TMI PEKKA MEIKAELAEINEN");
    const accounts = [{ ...own, holder: "MÖTTÖNEN ANNA" }, card];
    expect(industryCandidates([rent(), row("MOETTOENEN KULJETUS OY", CARD)], accounts)).toEqual([]);
    expect(industryCandidates([rent(), row("MOETTOENEN KULJETUS OY", CARD)], [own, card])).toEqual(["Moettoenen Kuljetus"]);
  });

  it("a letter the cleaning does not know stays a letter of the name", () => {
    // the merchant is made without the Ł, the bank's own text keeps the word whole
    const accounts = [{ ...own, holder: "RYŁSKI JAN" }, card];
    const paid = row("TMI ADAM RYŁSKI", CARD);
    expect(paid.merchant).toBe("Tmi Adam Ry Ski");
    expect(industryCandidates([rent(), paid], accounts)).toEqual([]);
    expect(industryCandidates([rent(), paid], [own, card])).toEqual(["Tmi Adam Ry Ski"]);
  });

  it("a surname that is a town too, which the merchant name has lost", () => {
    const paid = row("LIISA TAPIOLA", CARD);
    expect(paid.merchant).toBe("Liisa");
    expect(industryCandidates([rent(), paid], [{ ...own, holder: "TAPIOLA MATTI" }, card])).toEqual([]);
    // to another household she is a first name on a card row, which a shop's name may be
    expect(industryCandidates([rent(), paid], [own, card])).toEqual(["Liisa"]);
  });

  it("a shop with none of those words is asked about as before", () => {
    for (const [kind, fields] of Object.entries(EVIDENCE)) expect(asked(row("LANKAPUOTI ILO", fields)), kind).toEqual(["Lankapuoti Ilo"]);
  });
});

describe("the words of the household's names (householdWords, namesHousehold)", () => {
  const words = householdWords(["MEIKÄLÄINEN MATTI J, KORHONEN ELISA MARIA", "Elisa", null, ""]);

  it("are every word of a holder line and of a display name, folded", () => {
    expect([...words].sort()).toEqual(["ELISA", "KORHONEN", "MARIA", "MATTI", "MEIKALAINEN"]);
  });

  it("leave out an initial, a company form and the word between two names", () => {
    expect([...householdWords(["ESIMERKKI CONSULTING OY", "Matti ja Elisa", "TMI M MEIKALAINEN"])].sort()).toEqual(["CONSULTING", "ELISA", "ESIMERKKI", "MATTI", "MEIKALAINEN"]);
    // so a firm's account does not keep every company out, and an initial keeps out no shop with a letter in its name
    const firm = [{ ...own, holder: "ESIMERKKI CONSULTING OY, MEIKALAINEN MATTI K" }, card];
    expect(industryCandidates([rent(), row("PIKKUPUOTI OY", CARD), row("K-PUOTI ILO", CARD), row("ESIMERKKI HUOLTO", CARD)], firm)).toEqual(["Pikkupuoti", "K-Puoti Ilo"]);
  });

  it("match a word, one of five letters or more at either end of a longer word, and the start of one as the last word", () => {
    for (const name of ["Meikäläinen Huolto", "HUOLTO MEIKALAINEN", "Mattimeikalainen", "Elisan Kukka", "Kukka-Maria", "Rosamaria Shop", "Tmi Pekka Meikalai", "Huolto Meik", "Meikaelaeinen Oy"]) {
      expect(namesHousehold(name, words), name).toBe(true);
    }
  });

  it("do not match the start of one before the last word, a shorter start, a word with one in its middle, or a name in the genitive", () => {
    // a bank cuts a name at its end. "Meikäläisen Huolto" is a firm named for a family and no person's name: it is asked about
    for (const name of ["Meikalai Huolto", "Huolto Mei", "Lankapuoti Ilo", "Kamariano Shop", "Meikäläisen Huolto", "Korhosen Kuljetus", "Matin Kauppa"]) expect(namesHousehold(name, words), name).toBe(false);
    expect(namesHousehold("Meikäläinen Huolto", new Set())).toBe(false);
  });
});

describe("money in is never asked about", () => {
  it("a refund from the payee, or money from a person, is no candidate and rules nothing out", () => {
    const refund = row("ESIMERKKI HUOLTO", { ...INVOICE, amountCents: 2500 });
    const fromPerson = row("VIRTANEN LIISA", { counterpartyIban: IBAN, amountCents: 4000 });
    expect(asked(refund, fromPerson)).toEqual([]);
    expect(asked(row("ESIMERKKI HUOLTO", INVOICE), refund)).toEqual(["Esimerkki Huolto"]);
    // the register's answer is for spending: a refund keeps its own sorting
    const [sorted] = enrichTransactions([refund], ACCOUNTS, [], new Map([[refund.merchant, "car"]]));
    expect(sorted?.categorySource).not.toBe("industry");
  });
});

describe("generated payees: no word of a household name leaves", () => {
  const HOUSE = ["MEIKÄLÄINEN", "MATTI", "KORHONEN", "ELISA", "MARIA", "MEIKALAI", "MATTIMEIKÄLÄINEN", "KORHONEN-VIRTANEN"];
  const NAMES = ["PEKKA", "LIISA", "VIRTANEN", "VIRTA"];
  const COMPANY = ["OY", "TMI", "HUOLTO", "KULJETUS", "ZORRO", "A&B"];
  const POOL = [...HOUSE, ...NAMES, ...COMPANY];
  const payees = [...POOL, ...POOL.flatMap((a) => POOL.map((b) => `${a} ${b}`)), ...POOL.flatMap((a) => POOL.flatMap((b) => POOL.map((c) => `${a} ${b} ${c}`)))];
  /** The household's words, found without the code under test: in the letters of a name with no accent. */
  const letters = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  const OWN = ["MEIKALAINEN", "MATTI", "KORHONEN", "ELISA", "MARIA"];
  /** A word of the household's anywhere in the name, also glued to another, or the start of one where a bank would have cut it: at the end. */
  const holdsOwn = (name: string) => OWN.some((word) => letters(name).includes(word)) || OWN.some((word) => /[A-Z]{4,}$/.test(letters(name)) && word.startsWith(/[A-Z]+$/.exec(letters(name))![0]));
  const landlord = rent();
  /** The merchant is made once for a payee: no text of these rows changes it. */
  const merchants = new Map(payees.map((payee) => [payee, normalizeMerchant(payee, null)]));
  const paid = (payee: string, fields: Fields) => tx({ accountId: "chk", bookingDate: "2026-09-01", amountCents: -2500, counterparty: payee, merchant: merchants.get(payee)!, ...fields });
  /** One payee at a time: a row that rules its merchant out must not hide another payee's leak. */
  const sent = (accounts: Account[], household?: ReadonlySet<string>, evidence: Fields[] = Object.values(EVIDENCE)) => {
    const out: string[] = [];
    for (const payee of payees) {
      for (const fields of evidence) out.push(...industryCandidates([landlord, paid(payee, fields)], accounts, household));
      out.push(...industryCandidates([landlord, paid(payee, INVOICE), paid(payee, CARD)], accounts, household));
    }
    return out;
  };

  it("holds over every payee of one to three words from the household's names, other names and company words", () => {
    expect(payees.length).toBe(18 + 18 * 18 + 18 * 18 * 18);
    const names = sent(ACCOUNTS, MEMBERS);
    expect(names.filter(holdsOwn)).toEqual([]);
    // the payees without such a word are still asked about
    expect(new Set(names).size).toBeGreaterThan(200);
    expect(names).toContain("Zorro Huolto");
  }, 30_000);

  it("would not hold for a household nobody has named", () => {
    const leaks = new Set(sent(UNNAMED, undefined, [CARD]).filter(holdsOwn));
    expect(leaks.size).toBeGreaterThan(500);
    expect(leaks).toContain("Meikäläinen Huolto");
    expect(leaks).toContain("Elisa");
  }, 30_000);
});
