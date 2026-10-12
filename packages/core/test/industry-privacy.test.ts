/**
 * The trade register is a public service outside the household: a person's name must never be sent to it. These tests
 * hold that line. Every name here is made up.
 */
import { describe, expect, it } from "vitest";
import { businessMerchants, industryCandidates, isBusinessRow, isLookupName, shorterQuery } from "../src/industry.ts";
import { fold, normalizeMerchant } from "../src/merchant.ts";
import type { Account, Transaction } from "../src/types.ts";
import { hasBusinessWord, hasPayeeForm, isPersonShaped, namesBusiness } from "../src/wording.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
const IBAN = "FI4950009420028731";
/** What a card terminal leaves as the text when the bank gives the shop's name apart. */
const TERMINAL = "483920 HELSINKI";

type Fields = Partial<Transaction> & { reference?: string };

/** A row as ingest stores it: the merchant is made from the bank's own texts. A stored row carries its reference number. */
const row = (counterparty: string | null, fields: Fields = {}): Transaction =>
  tx({ accountId: "chk", bookingDate: "2026-09-01", amountCents: -2500, counterparty, merchant: normalizeMerchant(counterparty, fields.description ?? null), ...fields });

/** An outgoing transfer with a payee account: the ledger delivers them, so a row without one is not the layout's doing. */
const rent = () =>
  tx({ accountId: "chk", bookingDate: "2026-09-02", amountCents: -70000, merchant: "Vuokranantaja", counterparty: "VUOKRANANTAJA", counterpartyIban: "FI4950009420028732", category: "housing", categorySource: "rule" });

const candidates = (...rows: Transaction[]) => industryCandidates([rent(), ...rows], [checking, card]);

describe("industry lookup: a person's name is never a candidate", () => {
  it("does not take the name behind a MobilePay prefix for a shop", () => {
    const person = (fields: Fields = {}) => row("MOB.PAY*MATTI JUHANI MEIKAL", { description: TERMINAL, ...fields });
    expect(person().merchant).toBe("Matti Juhani Meikal");
    // on the bank account, twice without a payee account
    expect(candidates(person(), person())).toEqual([]);
    // on a card account, and with a merchant code
    expect(candidates(person({ accountId: "card" }), person({ accountId: "card" }))).toEqual([]);
    expect(candidates(person({ accountId: "card", mcc: "5999" }))).toEqual([]);
    // a single word behind the prefix is still a person's
    expect(candidates(row("MOB.PAY*MEIKALAINEN", { accountId: "card", description: TERMINAL }))).toEqual([]);
    // the field is short: "KY" is where the bank cut Kyllikki
    expect(candidates(row("MOB.PAY*VIRTANEN LIISA KY", { accountId: "card", description: TERMINAL }))).toEqual([]);
  });

  it("asks about a company behind a MobilePay prefix: a company form or a business word in the name", () => {
    const cafe = () => row("MOB.PAY*KAHVILA ILO OY", { description: TERMINAL });
    expect(candidates(cafe(), cafe())).toEqual(["Kahvila Ilo Oy"]);
    expect(candidates(row("MOB.PAY*KUKKAKAUPPA RUUSU", { accountId: "card", description: TERMINAL }))).toEqual(["Kukkakauppa Ruusu"]);
    expect(candidates(tx({ accountId: "chk", bookingDate: "2026-09-01", amountCents: -999, merchant: "Aanikirja Oy", description: "MOB.PAY*AANIKIRJA OY 7Q2K9X HELSINKI" }))).toEqual(["Aanikirja Oy"]);
  });

  it("does not take two payments without a payee account for a shop", () => {
    // some banks deliver a transfer to a person so: surname first, no account, no reference, a free message
    const person = () => row("MEIKALAINEN MATTI", { description: "KIITOS LAINASTA" });
    expect(candidates(person(), person())).toEqual([]);
    expect(businessMerchants([rent(), person(), person()]).size).toBe(0);
    // a missing account is no evidence for any other name either
    const shop = () => row("LYHTYPUOTI");
    expect(candidates(shop(), shop())).toEqual([]);
    const transfer = () => row(null, { description: "SIIRTO" });
    expect(candidates(transfer(), transfer())).toEqual([]);
  });

  it("asks about an invoice's payee: a payee account and a reference number", () => {
    const invoice = (fields: Fields = {}) => row("AUTOLIIKE ESIMERKKI", { counterpartyIban: IBAN, reference: "1234561", ...fields });
    expect(candidates(invoice())).toEqual(["Autoliike Esimerkki"]);
    expect(candidates(invoice({ reference: "RF18 5390 0754 7034" }))).toEqual(["Autoliike Esimerkki"]);
    // a message in the reference field is no reference number
    expect(candidates(invoice({ reference: "kiitos" }))).toEqual([]);
    // a transfer with a message stays a transfer, and one such row rules the name out
    const transfer = row("AUTOLIIKE ESIMERKKI", { counterpartyIban: IBAN, description: "KIITOS" });
    expect(candidates(transfer)).toEqual([]);
    expect(candidates(invoice(), transfer)).toEqual([]);
    // an invoice from a person (a private landlord, a sole trader in their own name) is not asked about
    expect(candidates(row("MEIKALAINEN MATTI", { counterpartyIban: IBAN, reference: "1234561" }))).toEqual([]);
  });

  it("does not ask about a name shaped like a person's, whatever the row says", () => {
    const evidence: Fields[] = [{ accountId: "card" }, { mcc: "5999" }, { description: "KORTTIOSTO 01.09" }, { description: TERMINAL }, { counterpartyIban: IBAN, reference: "1234561" }];
    // a shop named like a person ("Pikku Ilona") is the accepted cost
    for (const name of ["LIISA VIRTANEN", "VIRTANEN LIISA MARJATTA", "ANNA-LIISA VON ESIMERKKI", "PIKKU ILONA"]) {
      for (const fields of evidence) expect(candidates(row(name, fields)), `${name} ${JSON.stringify(fields)}`).toEqual([]);
    }
    // the same rows with a business's name are asked about
    for (const fields of evidence) expect(candidates(row("PIKKUPUOTI", fields))).toEqual(["Pikkupuoti"]);
    // a company form makes a sole trader's name a business name
    expect(candidates(row("TMI MATTI VIRTANEN", { accountId: "card" }))).toEqual(["Tmi Matti Virtanen"]);
  });

  it("rules a merchant out when the bank's own text names a person", () => {
    // a brand rule shortens the name: the merchant is "Max", the payee is a person
    const person = row("MAX MEIKALAINEN", { accountId: "card" });
    expect(person.merchant).toBe("Max");
    expect(candidates(person)).toEqual([]);
    expect(candidates(person, row("MAX", { accountId: "card" }))).toEqual([]);
  });

  it("reads a name's letters whole where the merchant name lost one", () => {
    // the merchant is made without the Ş, and "Ay" in front reads as a company form
    const person = (fields: Fields = {}) => row("AYŞE ESIMERKKI", fields);
    expect(person().merchant).toBe("Ay E Esimerkki");
    for (const fields of [{ accountId: "card" }, { description: "KORTTIOSTO" }, { counterpartyIban: IBAN, reference: "1234561" }]) expect(candidates(person(fields))).toEqual([]);
    expect(isBusinessRow(person({ counterpartyIban: IBAN }), new Set())).toBe(false);
    expect(candidates(row("RENÉ ESIMERKKI", { accountId: "card" }), row("SØREN ESIMERKKI", { accountId: "card" }))).toEqual([]);
  });

  it("finds no generated person's name among the candidates", () => {
    const FIRST = ["Matti", "Maija", "Väinö", "Åke", "Kyllikki", "Oskari", "Abel"];
    const MIDDLE = [null, "Juhani", "Kyllikki", "Oskari", "Ryan", "Anna-Liisa"];
    const LAST = ["Meikäläinen", "Virtanen", "Mäkinen", "Ryhänen", "Kyllönen", "Öhman", "Kallio", "Lahti", "von Esimerkki"];
    const names: string[] = [];
    for (const first of FIRST) {
      for (const middle of MIDDLE) {
        for (const last of LAST) {
          const given = [first, middle].filter(Boolean).join(" ");
          names.push(`${given} ${last}`.toUpperCase(), `${last} ${given}`.toUpperCase());
        }
      }
    }
    const cutAt = (length: number) => [...new Set(names.map((name) => name.slice(0, length).trim()))];
    /** Every way a row without a payee account can look like a purchase, for a name as the bank wrote it. */
    const withoutAccount: Record<string, (name: string) => Transaction[]> = {
      "two transfers without a payee account": (name) => [row(name, { description: "KIITOS" }), row(name, { description: "KIITOS" })],
      "a card account": (name) => [row(name, { accountId: "card" })],
      "a merchant code": (name) => [row(name, { mcc: "5999" })],
      "card text": (name) => [row(name, { description: "KORTTIOSTO 01.09" })],
      "a card terminal's text": (name) => [row(name, { description: TERMINAL })],
      "MobilePay on a card account": (name) => [row(name, { accountId: "card", description: "MOBILEPAY" })],
      "a row with card text and a row without": (name) => [row(name, { description: "KORTTIOSTO" }), row(name)],
    };
    const leaks: string[] = [];
    // names that share no merchant are judged apart, so one call takes them all
    const check = (label: string, rows: Transaction[]) => leaks.push(...candidates(...rows).map((merchant) => `${label}: ${merchant}`));
    for (const [shape, rows] of Object.entries(withoutAccount)) {
      // the bank gives the name whole, or cuts it at 17 characters: then "KY" may be Kyllikki
      check(shape, names.flatMap(rows));
      check(`${shape}, cut at 17`, cutAt(17).flatMap(rows));
    }
    // with a payee account the name comes whole, from the payment order
    check("an invoice", names.map((name) => row(name, { counterpartyIban: IBAN, reference: "1234561" })));
    // behind a wallet's prefix the name shares a short field: cut at 15 characters or later
    for (let length = 15; length <= 26; length++) {
      for (const prefix of length === 17 ? ["MOB.PAY*", "MOBPAY*", "MOB PAY *"] : ["MOB.PAY*"]) {
        for (const accountId of ["chk", "card"]) {
          const wallet = (name: string) => row(`${prefix}${name}`, { accountId, description: TERMINAL });
          check(`${prefix} at ${length} on ${accountId}`, cutAt(length).flatMap((name) => [wallet(name), wallet(name)]));
        }
      }
    }
    expect(names.length).toBe(756);
    expect(cutAt(17)).toContain("VIRTANEN MAIJA KY");
    expect(leaks).toEqual([]);
  });

  it("does not shorten a business name to a person's", () => {
    expect(shorterQuery("Matti Meikäläinen Oy")).toBeNull();
    expect(shorterQuery("Matti Meikäläinen Kuljetus")).toBeNull();
    expect(shorterQuery("Tmi Matti Juhani Meikäläinen")).toBeNull();
    expect(shorterQuery("Kukkakauppa Ilo Kallio")).toBe("Kukkakauppa Ilo");
  });
});

describe("the shape of a person's name (isPersonShaped)", () => {
  const shaped = (name: string, cutFrom?: number) => isPersonShaped(fold(name), cutFrom);

  it("is two to four words of letters, surname first or last", () => {
    for (const name of [
      "Matti Meikäläinen",
      "MEIKÄLÄINEN MATTI",
      "MEIKÄLÄINEN MATTI JUHANI",
      "Meikäläinen, Matti",
      "ANNA-LIISA VIRTANEN",
      "SEAN O'ESIMERKKI",
      "MATTI J. MEIKÄLÄINEN",
      "M.J. MEIKÄLÄINEN",
      "A.MEIKÄLÄINEN MATTI",
      "CARL GUSTAF VON ESIMERKKI",
      "AYŞE ESIMERKKI",
      "KIM SE JIN",
      "PIKKU ILONA",
      // a digit glued to a word is a slip of the hand: the word is still a name's
      "MEIKÄLÄINEN2 MATTI",
      "MATTI MEIKÄLÄINEN2",
      "2MATTI MEIKÄLÄINEN",
      "M3IKÄLÄINEN MATTI",
    ]) {
      expect(shaped(name), name).toBe(true);
    }
    for (const name of ["Meikäläinen", "", "YKSI KAKSI KOLME NELJÄ VIISI", "H&M HENNES", "VERKKOKAUPPA.COM HELSINKI", "MEIKÄLÄINEN2", "24 MEIKÄLÄINEN"]) {
      expect(shaped(name), name).toBe(false);
    }
  });

  it("holds for a name the bank cut at its field length", () => {
    for (const name of ["MATTI JUHANI MEIKAL", "MEIKALAINEN MATTI J", "VIRTANEN ANNA-", "VIRTANEN ANNA-L"]) expect(shaped(name), name).toBe(true);
  });

  it("is not a name with a company form or a business word", () => {
    for (const name of ["TMI MATTI VIRTANEN", "MATTI VIRTANEN OY", "OY KARL ESIMERKKI AB", "TIKKURILAN TIIKERIT RY", "AUTOLIIKE ESIMERKKI", "ZORRO KAUPPA", "VIRTASEN KULJETUS", "ESIMERKKI GROUP"]) {
      expect(shaped(name), name).toBe(false);
    }
    // SE and AS are too often part of a person's name to count
    expect(hasPayeeForm("KIM SE JIN")).toBe(false);
    expect(hasBusinessWord(fold("Kukkakauppa Ruusu"))).toBe(true);
    // a business word is a whole word or the end of a compound
    expect(hasBusinessWord("LIIKENNE VIRTANEN")).toBe(false);
    expect(hasBusinessWord("KAUPPINEN MATTI")).toBe(false);
  });

  it("reads a last word that a name can begin with as a cut name, where the bank may have cut it", () => {
    expect(shaped("VIRTANEN LIISA KY")).toBe(false);
    expect(shaped("VIRTANEN LIISA KY", 3)).toBe(true);
    expect(shaped("MATTI JUHANI RY", 3)).toBe(true);
    expect(shaped("VIRTANEN MATTI OSK", 3)).toBe(true);
    // one word and a form is a company unless the field is short enough to cut after one word
    expect(shaped("LAHTINEN KY", 3)).toBe(false);
    expect(shaped("LAHTINEN KY", 2)).toBe(true);
    // a form no name begins with, and a form in front, hold anywhere
    expect(shaped("METSÄ LAHTINEN OY", 2)).toBe(false);
    expect(hasPayeeForm("TMI MATTI KY", 2)).toBe(true);
  });

  it("keeps a person-shaped name out of the lookup names", () => {
    expect(isLookupName("Matti Meikäläinen")).toBe(false);
    expect(isLookupName("Meikäläinen Matti Juhani")).toBe(false);
    expect(isLookupName("Autoliike Esimerkki")).toBe(true);
    expect(isLookupName("Pikkupuoti")).toBe(true);
  });
});

describe("business rows: positive evidence only (isBusinessRow)", () => {
  const cards = new Set(["card"]);

  it("knows a card terminal's text", () => {
    expect(isBusinessRow(row("PIKKUPUOTI", { description: TERMINAL }), cards)).toBe(true);
    expect(isBusinessRow(row("PIKKUPUOTI", { description: "0042 483920 ISO OMENA" }), cards)).toBe(true);
    expect(isBusinessRow(row("SUMUP *PIKKUPUOTI"), cards)).toBe(true);
    expect(isBusinessRow(row(null, { description: "ZETTLE_*PIKKUPUOTI" }), cards)).toBe(true);
    // a message, a number alone, a town alone, a payee account
    expect(isBusinessRow(row("PIKKUPUOTI", { description: "KIITOS" }), cards)).toBe(false);
    expect(isBusinessRow(row("PIKKUPUOTI", { description: "483920" }), cards)).toBe(false);
    expect(isBusinessRow(row("PIKKUPUOTI", { description: "483920 KIITOS" }), cards)).toBe(false);
    expect(isBusinessRow(row("PIKKUPUOTI", { description: TERMINAL, counterpartyIban: IBAN }), cards)).toBe(false);
    // the text of a row that names no payee is the name itself
    expect(isBusinessRow(row(null, { description: TERMINAL }), cards)).toBe(false);
    // a message that starts like a prefix beside the payee's name
    expect(isBusinessRow(row("PIKKUPUOTI", { description: "LAHJA *SINULLE" }), cards)).toBe(false);
  });

  it("takes an invoice for a business payment", () => {
    expect(isBusinessRow(row("PIKKUPUOTI", { counterpartyIban: IBAN, reference: "1234561" }), cards)).toBe(true);
    expect(isBusinessRow(row("PIKKUPUOTI", { counterpartyIban: IBAN }), cards)).toBe(false);
    expect(isBusinessRow(row("PIKKUPUOTI", { reference: "1234561" }), cards)).toBe(false);
  });

  it("does not take a MobilePay payment to a bare name for a purchase", () => {
    expect(isBusinessRow(row("LIISA", { accountId: "card", description: "MOBILEPAY" }), cards)).toBe(false);
    expect(isBusinessRow(row("LIISA VIRTANEN", { mcc: "5999", description: "MOBILEPAY" }), cards)).toBe(false);
    expect(isBusinessRow(row("MOB.PAY*MATTI JUHANI MEIKAL", { accountId: "card", description: TERMINAL }), cards)).toBe(false);
    // a company form or a business word in the name
    expect(isBusinessRow(row("TIKKURILAN TIIKERIT RY", { accountId: "card", description: "MOBILEPAY" }), cards)).toBe(true);
    expect(isBusinessRow(row("MOB.PAY*KAHVILA ILO OY", { description: TERMINAL }), cards)).toBe(true);
    expect(isBusinessRow(row("MOB.PAY*LANKAPUOTI"), cards)).toBe(true);
    expect(isBusinessRow(row("MOB.PAY*ESIMERKKI AB"), cards)).toBe(true);
  });
});

describe("a name that may be cut: a row without a payee account", () => {
  it("does not read a last word that a name begins with as a company form", () => {
    // two names and "RY" may be Ryhänen, "KY" Kyllikki
    expect(candidates(row("VIRTANEN MAIJA KY", { accountId: "card" }))).toEqual([]);
    expect(candidates(row("TIKKURILAN TIIKERIT RY", { accountId: "card", description: "MOBILEPAY" }))).toEqual([]);
    // with its account the name comes whole
    expect(candidates(row("TIKKURILAN TIIKERIT RY", { counterpartyIban: IBAN, reference: "1234561" }))).toEqual(["Tikkurilan Tiikerit Ry"]);
    // one word and a form, or a form no name begins with, is a company on any row
    expect(candidates(row("LAHTINEN KY", { accountId: "card" }))).toEqual(["Lahtinen Ky"]);
    expect(candidates(row("METSÄ LAHTINEN OY", { accountId: "card" }))).toEqual(["Metsä Lahtinen Oy"]);
  });

  it("behind a prefix the field is short: one name and such a word is a cut name too", () => {
    expect(candidates(row("MOB.PAY*MEIKALAINEN OSK", { accountId: "card" }))).toEqual([]);
    expect(candidates(row("SUMUP *LAHTINEN KY"))).toEqual([]);
    expect(candidates(row("SUMUP *LAHTINEN OY"))).toEqual(["Lahtinen Oy"]);
  });
});

describe("business merchants: a shop's rows without card text (businessMerchants)", () => {
  // a CSV export names a card purchase by its title alone
  const bare = () => row(null, { description: "LYHTYPUOTI" });
  const withText = () => row(null, { description: "KORTTIOSTO LYHTYPUOTI" });

  it("counts them once a row shows a card purchase", () => {
    expect(withText().merchant).toBe(bare().merchant);
    expect([...businessMerchants([rent(), bare(), withText()])]).toEqual(["Lyhtypuoti"]);
    expect(candidates(bare(), withText())).toEqual(["Lyhtypuoti"]);
    expect(candidates(withText())).toEqual(["Lyhtypuoti"]);
    // no row shows one
    expect(businessMerchants([rent(), bare(), bare()]).size).toBe(0);
    expect(candidates(bare(), bare())).toEqual([]);
  });

  it("not in a ledger that has no payee accounts at all", () => {
    const rows = [bare(), withText()];
    expect(businessMerchants(rows).size).toBe(0);
    expect(industryCandidates(rows, [checking])).toEqual([]);
  });

  it("never a person's rows", () => {
    const person = (fields: Fields = {}) => row("LIISA VIRTANEN", fields);
    const rows = [rent(), person({ description: "KORTTIOSTO" }), person()];
    // the row with card text is a business row by itself (a sole trader's terminal), yet the name is not asked about
    expect(industryCandidates(rows, [checking])).toEqual([]);
    const wallet = () => row("MOB.PAY*MATTI JUHANI MEIKAL", { description: TERMINAL });
    expect(businessMerchants([rent(), wallet(), wallet()]).size).toBe(0);
  });
});

describe("an invoice's payee: the payer typed the name, and a private landlord gives a reference number too", () => {
  const invoice = (counterparty: string | null, fields: Fields = {}) => row(counterparty, { counterpartyIban: IBAN, reference: "1234561", ...fields });
  const asked = (counterparty: string | null, fields: Fields = {}) => candidates(invoice(counterparty, fields), invoice(counterparty, fields));

  it("is no evidence for a name with no company form and no business word", () => {
    // a surname alone, an initial, a name written together or with a full stop, a digit glued to it
    for (const name of ["MEIKÄLÄINEN", "M.MEIKÄLÄINEN", "MattiMeikäläinen", "MATTI.MEIKÄLÄINEN", "MEIKÄLÄINEN2 MATTI"]) {
      expect(asked(name), name).toEqual([]);
      expect(isBusinessRow(invoice(name), new Set()), name).toBe(false);
    }
  });

  it("is none for a first name whose surname the merchant name lost as a town", () => {
    expect(invoice("MATTI KIVISTÖ").merchant).toBe("Matti");
    expect(asked("MATTI KIVISTÖ")).toEqual([]);
    expect(invoice("ANNA-LIISA LAHTI").merchant).toBe("Anna-Liisa");
    expect(asked("ANNA-LIISA LAHTI")).toEqual([]);
  });

  it("is none when two name words stand on one side of the business word: a club names the child, a sole trader the owner", () => {
    for (const name of ["ESIMERKIN TANSSIKERHO VILLE MEIKÄLÄINEN", "KYLÄYHDISTYS RY MATTI MEIKÄLÄINEN", "MATTI MEIKÄLÄINEN KULJETUS", "KULJETUS ESIMERKKI OY MATTI MEIKÄLÄINEN"]) {
      expect(asked(name), name).toEqual([]);
      expect(isBusinessRow(invoice(name), new Set()), name).toBe(false);
    }
  });

  it("is none without the payee field: the merchant is then made from the payer's own message", () => {
    expect(invoice(null, { description: "TANSSIKERHO VILLE MEIKÄLÄINEN SYKSY" }).merchant).toBe("Tanssikerho Ville Meikäläinen Syksy");
    expect(asked(null, { description: "TANSSIKERHO VILLE MEIKÄLÄINEN SYKSY" })).toEqual([]);
    expect(asked(null, { description: "AUTOLIIKE ESIMERKKI" })).toEqual([]);
    expect(asked("  ", { description: "AUTOLIIKE ESIMERKKI" })).toEqual([]);
    expect(asked(null, { description: "SIIRTO" })).toEqual([]);
    expect(isBusinessRow(invoice(null, { description: "AUTOLIIKE ESIMERKKI" }), new Set())).toBe(false);
  });

  it("asks about a payee named as a business, with at most one name word on each side of the word", () => {
    expect(asked("AUTOLIIKE ESIMERKKI")).toEqual(["Autoliike Esimerkki"]);
    expect(asked("ESIMERKIN TANSSIKERHO")).toEqual(["Esimerkin Tanssikerho"]);
    expect(asked("KULJETUS ESIMERKKI")).toEqual(["Kuljetus Esimerkki"]);
    // the merchant name drops the town
    expect(asked("ESIMERKIN AUTOHUOLTO KALLIO")).toEqual(["Esimerkin Autohuolto"]);
    expect(asked("MEIKÄLÄINEN KERHO VILLE")).toEqual(["Meikäläinen Kerho Ville"]);
    // a company form at either end is evidence on any row, an invoice or not
    expect(asked("ESIMERKIN PALLOSEURA RY", { description: "KAUSIMAKSU VILLE MEIKÄLÄINEN" })).toEqual(["Esimerkin Palloseura Ry"]);
  });
});

describe("a processor that also pays people: the name behind its prefix", () => {
  it("is not asked about when PayPal prints a private recipient as one word", () => {
    // on a card account
    expect(row("PAYPAL *MATTIMEIKALAINEN").merchant).toBe("Mattimeikalainen");
    expect(candidates(row("PAYPAL *MATTIMEIKALAINEN", { accountId: "card" }))).toEqual([]);
    // once on a bank account, with the text PayPal leaves and without
    expect(candidates(row("PAYPAL *MATTIMEIKAL", { description: "35314369001 LUXEMBOURG" }))).toEqual([]);
    expect(candidates(row("PAYPAL *MATTIMEIKAL"))).toEqual([]);
    expect(candidates(row("PAYPAL *MATTIMEIKAL"), row("PAYPAL *MATTIMEIKAL"))).toEqual([]);
    // the short prefix, a merchant code, the prefix in the payment text
    expect(candidates(row("PP*MATTIMEIKAL", { accountId: "card", mcc: "5999" }))).toEqual([]);
    expect(candidates(row(null, { accountId: "card", description: "PAYPAL *MATTIMEIKALAINEN 35314369001 LUXEMBOURG" }))).toEqual([]);
    expect(isBusinessRow(row("PAYPAL *MATTIMEIKALAINEN", { accountId: "card" }), new Set(["card"]))).toBe(false);
  });

  it("is asked about with a company form or a business word", () => {
    expect(candidates(row("PAYPAL *LANKAPUOTI", { accountId: "card" }))).toEqual(["Lankapuoti"]);
    expect(candidates(row("PAYPAL *ESIMERKKI OY"))).toEqual(["Esimerkki Oy"]);
    expect(candidates(row("PP*ESIMERKKI SHOP", { accountId: "card" }))).toEqual(["Esimerkki Shop"]);
  });

  it("a card terminal's prefix still shows a shop", () => {
    expect(candidates(row("SUMUP *PIKKUPUOTI"))).toEqual(["Pikkupuoti"]);
    expect(candidates(row("SUMUP *MATTI MEIKALAINEN", { accountId: "card" }))).toEqual([]);
  });
});

describe("the name of a way to pay is no merchant's name", () => {
  it("is never a lookup name", () => {
    for (const name of ["Siirto", "Pikasiirto", "Tilisiirto", "Maksu", "Viitemaksu", "Verkkopankki", "Verkkomaksu", "MobilePay", "Pivo", "Siirto Maksu"]) expect(isLookupName(name), name).toBe(false);
    for (const name of ["Siirtopuoti", "Maksula", "Verkkopankki Esimerkki Oy"]) expect(isLookupName(name), name).toBe(true);
  });

  it("is not asked about, whatever the row says", () => {
    for (const text of ["SIIRTO", "PIKASIIRTO", "MAKSU", "VIITEMAKSU", "VERKKOPANKKI"]) {
      // the text of a row that names no payee, on a card account
      expect(candidates(row(null, { accountId: "card", description: text })), text).toEqual([]);
      // in the payee field beside a card terminal's text, and on an invoice
      expect(candidates(row(text, { description: TERMINAL })), text).toEqual([]);
      expect(candidates(row(text, { counterpartyIban: IBAN, reference: "1234561" })), text).toEqual([]);
    }
  });
});

describe("letters the cleaning does not know", () => {
  it("do not split a name into words that read as a company form", () => {
    // the merchant is made without the Ł: "Ry Ski Testi", "Testi Asa"
    expect(row("RYŁSKI TESTI").merchant).toBe("Ry Ski Testi");
    expect(candidates(row("RYŁSKI TESTI", { accountId: "card" }))).toEqual([]);
    expect(candidates(row("KYØSTI TESTI", { accountId: "card" }))).toEqual([]);
    expect(row("TESTI ŁASA").merchant).toBe("Testi Asa");
    expect(candidates(row("TESTI ŁASA", { accountId: "card" }))).toEqual([]);
    expect(candidates(row("TESTI BJØRN", { accountId: "card" }), row("TESTI STRAßE", { accountId: "card" }), row("ÆRØ TESTI", { accountId: "card" }))).toEqual([]);
  });

  it("do not make the first name Åsa the company form ASA", () => {
    for (const name of ["ÅSA MEIKÄLÄINEN", "MEIKÄLÄINEN ÅSA", "ASA MEIKALAINEN"]) {
      const rows: Fields[] = [{ counterpartyIban: IBAN }, { counterpartyIban: IBAN, description: "KIITOS" }, { accountId: "card" }, { counterpartyIban: IBAN, reference: "1234561" }];
      for (const fields of rows) expect(candidates(row(name, fields)), `${name} ${JSON.stringify(fields)}`).toEqual([]);
    }
  });
});

describe("a digit glued to a word of a name", () => {
  it("is not asked about, whatever the row says", () => {
    for (const name of ["MEIKÄLÄINEN2 MATTI", "MATTI2 MEIKÄLÄINEN", "MATTI MEIKÄLÄINEN2", "2MATTI MEIKÄLÄINEN", "M3IKÄLÄINEN MATTI"]) {
      const rows: Fields[] = [{ accountId: "card" }, { mcc: "5999" }, { description: TERMINAL }, { description: "KORTTIOSTO" }, { counterpartyIban: IBAN, reference: "1234561" }];
      for (const fields of rows) expect(candidates(row(name, fields)), `${name} ${JSON.stringify(fields)}`).toEqual([]);
    }
  });

  it("a business so named is asked about by its company form or its business word", () => {
    expect(candidates(row("KIOSKI24 ESIMERKKI OY", { accountId: "card" }))).toEqual(["Kioski24 Esimerkki Oy"]);
    expect(candidates(row("PESULA24 PALVELU", { accountId: "card" }))).toEqual(["Pesula24 Palvelu"]);
    expect(candidates(row("KIOSKI24", { accountId: "card" }))).toEqual(["Kioski24"]);
  });
});

describe("characters nobody sees: a soft hyphen of a copied page, a zero-width space, a direction mark", () => {
  it("do not split a name into words that read as a company form", () => {
    for (const name of ["MEIKÄLÄINEN HEN\u00ADRY", "MATTI LER\u200BOY", "MATTI SAA\u200EB", "MEIKÄLÄINEN VILS\u2060KY"]) {
      // a plain transfer to a payee account: the form was the only evidence
      expect(isBusinessRow(row(name, { counterpartyIban: IBAN }), new Set()), JSON.stringify(name)).toBe(false);
      const rows: Fields[] = [{ counterpartyIban: IBAN }, { accountId: "card" }, { description: TERMINAL }, { counterpartyIban: IBAN, reference: "1234561" }];
      for (const fields of rows) expect(candidates(row(name, fields)), `${JSON.stringify(name)} ${JSON.stringify(fields)}`).toEqual([]);
    }
  });

  it("do not hide the shape of a name", () => {
    for (const name of ["MATTI\u200B MEIKÄLÄINEN", "MEIKÄLÄINEN MATTI\u200E", "\uFEFFMATTI MEIKÄLÄINEN", "MATTI\u200BMEIKÄLÄINEN", "MAT\u00ADTI MEIKÄLÄINEN"]) {
      for (const fields of [{ accountId: "card" }, { description: TERMINAL }] as Fields[]) expect(candidates(row(name, fields)), `${JSON.stringify(name)} ${JSON.stringify(fields)}`).toEqual([]);
    }
    expect(isPersonShaped(fold("MATTI\u200B MEIKÄLÄINEN\u200E"))).toBe(true);
  });

  it("leave a company its form", () => {
    expect(candidates(row("ESIMERKKI\u200B OY", { counterpartyIban: IBAN }))).toEqual(["Esimerkki Oy"]);
    expect(candidates(row("KUKKA\u00ADKAUPPA RUUSU", { accountId: "card" }))).toHaveLength(1);
  });
});

describe("a company form as the first word", () => {
  it("is part of the name when a name begins with it: an abbreviated first name, two initials", () => {
    // a plain transfer to a payee account: the form in front was the only evidence
    expect(candidates(row("OSK. MEIKÄLÄINEN", { counterpartyIban: IBAN }))).toEqual([]);
    // a company written so is not asked about either: "AB ESIMERKKI" has the shape of two initials and a surname
    for (const name of ["OSK. MEIKÄLÄINEN", "OSK MEIKÄLÄINEN", "AB MEIKÄLÄINEN", "KY ESIMERKKI", "AY TESTI", "RY ESIMERKKI", "AB ESIMERKKI", "AB ESIMERKKI TRADING"]) {
      expect(candidates(row(name, { accountId: "card" })), name).toEqual([]);
      expect(candidates(row(name, { counterpartyIban: IBAN, reference: "1234561" })), name).toEqual([]);
      expect(isLookupName(normalizeMerchant(name, null)), name).toBe(false);
    }
  });

  it("is a company's when no name begins with it, or when a form ends the name too", () => {
    expect(candidates(row("TMI MATTI MEIKÄLÄINEN", { counterpartyIban: IBAN }))).toEqual(["Tmi Matti Meikäläinen"]);
    expect(candidates(row("OY ESIMERKKI AB", { accountId: "card" }))).toEqual(["Oy Esimerkki Ab"]);
    expect(candidates(row("AB ESIMERKKI OY", { accountId: "card" }))).toEqual(["Ab Esimerkki Oy"]);
    expect(candidates(row("KOY ESIMERKINKATU", { counterpartyIban: IBAN }))).toEqual(["Koy Esimerkinkatu"]);
  });
});

describe("the shorter query is never a person's name", () => {
  it("is not made from a company named after a person", () => {
    // a number between the name and the form
    expect(shorterQuery("Matti Esimerkki 2 Oy")).toBeNull();
    // a surname that is a town too: the first name alone would be left
    expect(shorterQuery("Matti Kivistö Oy")).toBeNull();
    expect(shorterQuery("Tmi Matti Kallio")).toBeNull();
    expect(shorterQuery("Autokorjaamo Matti Esimerkki Oy")).toBeNull();
    expect(shorterQuery("Matti Esimerkki Oy")).toBeNull();
    expect(shorterQuery("Tmi Matti Esimerkki")).toBeNull();
  });

  it("passes the gate of the first query whenever one is made", () => {
    const names = ["Kukkakauppa Ilo Kallio", "Lankapuoti Tikkurila Oy", "Kuljetus Esimerkki Oy Matti", "Esimerkin Tanssikerho Ville Meikäläinen", "Siirto Maksu Oy", "Pikku Puoti Vantaa Oy"];
    const shorter = names.map(shorterQuery);
    expect(shorter).toEqual(["Kukkakauppa Ilo", "Lankapuoti", "Kuljetus Esimerkki Oy", "Esimerkin Tanssikerho Ville", null, "Pikku Puoti Vantaa"]);
    for (const name of shorter) if (name) expect(isLookupName(name), name).toBe(true);
  });
});

describe("names the review asked about: what the code decides", () => {
  const INVOICE: Fields = { counterpartyIban: IBAN, reference: "1234561" };
  const CARD: Fields = { accountId: "card" };
  const none = (name: string) => {
    for (const fields of [INVOICE, CARD, { mcc: "5999" }, { description: TERMINAL }]) expect(candidates(row(name, fields)), `${name} ${JSON.stringify(fields)}`).toEqual([]);
  };

  it("an estate is not asked about", () => {
    for (const name of ["KUOLINPESÄ MATTI MEIKÄLÄINEN", "MATTI MEIKÄLÄISEN KUOLINPESÄ", "MEIKÄLÄINEN MATTI KP", "MEIKÄLÄINEN MATTI DBO"]) none(name);
  });

  it("two people are not asked about", () => {
    for (const name of ["MATTI JA LIISA MEIKÄLÄINEN", "MEIKÄLÄINEN MATTI & LIISA", "MATTI MEIKÄLÄINEN JA LIISA VIRTANEN"]) none(name);
  });

  it("a name with a title is not asked about", () => {
    for (const name of ["DI MATTI MEIKÄLÄINEN", "DR. MATTI MEIKÄLÄINEN", "ROUVA LIISA VIRTANEN"]) none(name);
  });

  it("a name with a town is not asked about", () => {
    expect(row("MATTI MEIKÄLÄINEN HELSINKI").merchant).toBe("Matti Meikäläinen");
    none("MATTI MEIKÄLÄINEN HELSINKI");
    none("MEIKÄLÄINEN MATTI VANTAA");
  });

  it("a first name before a town that is a surname too is asked about on a card row: the merchant name has lost the surname", () => {
    // merchant.ts knows five such towns; the task that owns it closes this
    expect(row("LIISA TAPIOLA").merchant).toBe("Liisa");
    expect(candidates(row("LIISA TAPIOLA", CARD))).toEqual(["Liisa"]);
    expect(candidates(row("LIISA TAPIOLA", INVOICE))).toEqual([]);
    none("LIISA KALLIO");
  });

  it("a shop named after a person is not asked about on a card row, a company named after one is", () => {
    none("PEKKA ESIMERKKI");
    none("PARTURI PEKKA ESIMERKKI");
    expect(candidates(row("PEKKA ESIMERKKI OY", CARD))).toEqual(["Pekka Esimerkki Oy"]);
    expect(candidates(row("LANKAPUOTI PEKKA ESIMERKKI", CARD))).toEqual(["Lankapuoti Pekka Esimerkki"]);
  });

  it("a one-word name is asked about on a card row: a shop named by a surname looks the same", () => {
    expect(candidates(row("MEIKÄLÄINEN", CARD))).toEqual(["Meikäläinen"]);
    expect(candidates(row("MEIKÄLÄINEN", { description: TERMINAL }))).toEqual(["Meikäläinen"]);
    // never from an invoice, a plain transfer or a wallet
    expect(candidates(row("MEIKÄLÄINEN", INVOICE))).toEqual([]);
    expect(candidates(row("MEIKÄLÄINEN", { counterpartyIban: IBAN }))).toEqual([]);
    expect(candidates(row("MEIKÄLÄINEN"), row("MEIKÄLÄINEN"))).toEqual([]);
    expect(candidates(row("MOB.PAY*MEIKALAINEN", CARD))).toEqual([]);
  });
});

describe("the words of a name (isPersonShaped, namesBusiness)", () => {
  const shaped = (name: string, cutFrom?: number) => isPersonShaped(fold(name), cutFrom);

  it("splits at a full stop between letters", () => {
    for (const name of ["M.MEIKÄLÄINEN", "MATTI.MEIKÄLÄINEN", "J.R.R. ESIMERKKI", "A.MEIKÄLÄINEN MATTI"]) expect(shaped(name), name).toBe(true);
    expect(shaped("MEIKÄLÄINEN.")).toBe(false);
  });

  it("does not count a word of digits", () => {
    expect(shaped("MATTI ESIMERKKI 2")).toBe(true);
    expect(shaped("ESIMERKKI 24")).toBe(false);
  });

  it("counts a word with a digit in it: the cost is a shop so named, which is not looked up either", () => {
    for (const name of ["FITNESS24 SEVEN", "KIOSKI24 ESIMERKKI", "ST1 VANTAA"]) expect(shaped(name), name).toBe(true);
    for (const name of ["Kioski24 Esimerkki", "Meikäläinen2 Matti"]) expect(isLookupName(name), name).toBe(false);
    // one word is no person's name, with a digit or without, and a business word or a company form still says business
    for (const name of ["Kioski24", "Kioski24 Esimerkki Oy", "Pesula24 Palvelu"]) expect(isLookupName(name), name).toBe(true);
  });

  it("reads a first word that a name begins with as a name", () => {
    // a company written with such a form in front ("AB ESIMERKKI") has the same shape as two initials and a surname
    for (const name of ["OSK. MEIKÄLÄINEN", "AB MEIKÄLÄINEN", "KY ANNA ESIMERKKI", "AB ESIMERKKI", "AB ESIMERKKI TRADING"]) expect(shaped(name), name).toBe(true);
    for (const name of ["OY ESIMERKKI AB", "AB ESIMERKKI OY", "TMI MATTI MEIKÄLÄINEN", "KOY ESIMERKINKATU"]) expect(shaped(name), name).toBe(false);
    // the category rules keep the plain rule: a form at either end
    expect(hasPayeeForm("AB MEIKALAINEN")).toBe(true);
  });

  it("knows a name that says it is a business and names no person beside it", () => {
    const business = (name: string) => namesBusiness(fold(name));
    for (const name of ["AUTOLIIKE ESIMERKKI", "ESIMERKIN TANSSIKERHO", "KULJETUS ESIMERKKI OY", "ESIMERKKI OY", "MATTI KULJETUS MEIKÄLÄINEN", "LANKAPUOTI"]) expect(business(name), name).toBe(true);
    // one name word on each side of the business word: a town and an owner stand so ("ESIMERKIN AUTOHUOLTO KALLIO"), and nobody writes a person's name around such a word
    for (const name of ["MEIKÄLÄINEN KERHO VILLE", "ESIMERKIN AUTOHUOLTO KALLIO", "ESIMERKIN TANSSIKERHO VILLE"]) expect(business(name), name).toBe(true);
    for (const name of [
      "MEIKÄLÄINEN",
      "MATTI MEIKÄLÄINEN",
      "MATTI MEIKÄLÄINEN KULJETUS",
      "M.MEIKÄLÄINEN KULJETUS",
      "ESIMERKIN TANSSIKERHO VILLE MEIKÄLÄINEN",
      "KYLÄYHDISTYS RY MATTI MEIKÄLÄINEN",
      "KULJETUS ESIMERKKI OY MATTI MEIKÄLÄINEN",
      "MATTI KULJETUS LIISA PALVELU",
      "",
    ]) {
      expect(business(name), name).toBe(false);
    }
  });
});
