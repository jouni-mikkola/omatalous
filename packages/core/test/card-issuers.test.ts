/**
 * A card issuer has one name whatever its legal suffix or word order, its plain name is an issuer's too, and the card
 * bills that count as spending are told by issuer with the reason their purchases are missing. Names and sums are made up.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { missingCardPurchases } from "../src/analysis/card-bills.ts";
import { dataQualityReport } from "../src/analysis/data-quality.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import { categorize, compileRules } from "../src/categorize.ts";
import { fold, normalizeMerchant } from "../src/merchant.ts";
import { type Account, NO_INPUTS } from "../src/types.ts";
import { formatEur } from "../src/analysis/format.ts";
import { isCardIssuerText } from "../src/wording.ts";
import { tx } from "./helpers.ts";

const name = (counterparty: string, description: string | null = null) => normalizeMerchant(counterparty, description);

describe("one display name per card issuer", () => {
  it.each([
    ["Morrow", "Morrow Bank"],
    ["MORROW BANK ASA", "Morrow Bank"],
    ["Morrow Bank Ab", "Morrow Bank"],
    ["Morrow Bank AB Filial", "Morrow Bank"],
    ["MORROW BANK ASA FILIAL I FINLAND", "Morrow Bank"],
    ["Komplett Bank ASA", "Morrow Bank"],
    ["SEB Kort Bank Ab", "SEB Kort"],
    ["SEB KORT", "SEB Kort"],
    ["Bank Norwegian AB", "Bank Norwegian"],
    ["Norwegian Bank ASA", "Bank Norwegian"],
    ["Resurs Bank AB", "Resurs Bank"],
    ["RESURS BANK", "Resurs Bank"],
    ["Entercard Group AB", "Entercard"],
    ["EnterCard Sweden AB", "Entercard"],
    ["Re:member", "Entercard"],
    ["REMEMBER", "Entercard"],
  ])("%s is %s", (raw, expected) => expect(name(raw)).toBe(expected));

  it("keeps the words that are other things: an airline, a shop, a staffing company, a coffee roaster", () => {
    expect(name("Norwegian Air Shuttle ASA")).toBe("Norwegian Air Shuttle Asa");
    expect(name("NORWEGIAN")).toBe("Norwegian");
    expect(name("Komplett ASA")).toBe("Komplett Asa");
    expect(name("KOMPLETT.FI")).toBe("Komplett.Fi");
    expect(name("Resurs Bemanning AB")).toBe("Resurs Bemanning Ab");
    expect(name("Resurssi Oy")).toBe("Resurssi");
    expect(name("Morrow Coffee Oy")).toBe("Morrow Coffee Oy");
    // the bank is ASA, AB or a filial, never an Oy; "FI" is a country the cleaning takes off, which the bank never writes
    for (const other of ["MORROW OY", "Morrow Oyj", "Morrow AS", "MORROW FI"]) expect(name(other), other).not.toBe("Morrow Bank");
    expect(name("Morrow Bank ASA")).toBe("Morrow Bank");
    // re:member is Entercard's own card brand (the card rules read it as a card already), but no company form of Finland goes with it
    for (const other of ["REMEMBER OY", "RE MEMBER OY"]) expect(name(other), other).not.toBe("Entercard");
    expect(name("SEB Korttelit Oy")).toBe("Seb Korttelit Oy");
    expect(name("Remember Me Oy")).toBe("Remember Me Oy");
    expect(name("Entercardio Oy")).toBe("Entercardio");
  });

  it("a payment to the issuer by its plain name follows the rules of the bank's name", () => {
    const category = (counterparty: string, description: string) => {
      const merchant = name(counterparty);
      return categorize({ merchant, counterparty, description, mcc: null, amountCents: -45000 }, compileRules([])).category;
    };
    for (const bank of ["MORROW", "Morrow Bank Ab", "SEB Kort Bank Ab", "SEB KORT"]) {
      expect(category(bank, "LASKU 09/2026"), bank).toBe("card_bill");
      expect(category(bank, "LAINAN LYHENNYS"), bank).toBe("loans");
      expect(category(bank, "SAASTOTILI"), bank).toBe("savings");
    }
    expect(category("MORROW OY", "LASKU 1234")).not.toBe("card_bill");
    // the shop and the airline are neither
    expect(category("KOMPLETT.FI", "LASKU 09/2026")).not.toBe("card_bill");
    expect(category("Norwegian Air Shuttle ASA", "LASKU 09/2026")).not.toBe("card_bill");
    expect(isCardIssuerText(fold(name("MORROW")))).toBe(true);
    expect(isCardIssuerText(fold("SEB Kort Bank Ab"))).toBe(true);
    expect(isCardIssuerText(fold("SEB Korttelit"))).toBe(false);
  });
});

describe("the card bills that count as spending, by issuer", () => {
  const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
  const cardOf = (id: string, bank: string | null, cardName = "Platinum"): Account => ({ id, name: cardName, bank, iban: null, currency: "EUR", type: "credit_card" });
  const today = "2026-10-09";
  const range = { from: "2025-10-10", to: today };
  const bill = (counterparty: string, bookingDate: string, euros: number) =>
    tx({ bookingDate, amountCents: -euros * 100, category: "card_bill", merchant: name(counterparty), counterparty, accountId: "acc-1" });
  /** The card's own rows begin on 1.9.2026. */
  const cardRows = (accountId: string) => [
    tx({ bookingDate: "2026-09-02", amountCents: -4200, category: "groceries", merchant: "K-Market", accountId }),
    tx({ bookingDate: "2026-09-01", amountCents: -1500, category: "groceries", merchant: "K-Market", accountId }),
  ];
  const rows = [
    // Morrow under three names, not connected
    bill("MORROW", "2025-12-05", 100),
    bill("Morrow Bank Asa", "2026-03-05", 200),
    bill("Morrow Bank Ab", "2026-09-05", 300),
    bill("SEB Kort Bank Ab", "2026-02-12", 250),
    bill("SEB Kort Bank Ab", "2026-08-12", 150),
    // connected, its rows begin on 1.9.: the bills before are the bank's history, those on the day and after are not
    bill("Bank Norwegian AB", "2026-05-20", 400),
    bill("BANK NORWEGIAN", "2026-06-20", 100),
    bill("Bank Norwegian AB", "2026-08-31", 30),
    bill("Bank Norwegian AB", "2026-09-01", 70),
    bill("Bank Norwegian AB", "2026-09-15", 80),
    bill("Resurs Bank AB", "2026-07-02", 90),
    bill("Entercard Group AB", "2026-07-15", 60),
    // outside the range, and a bill that is no spending
    bill("Resurs Bank AB", "2025-08-02", 999),
    tx({ bookingDate: "2026-07-03", amountCents: 5000, category: "card_bill", merchant: "Resurs Bank", accountId: "acc-1" }),
    ...cardRows("card-nb"),
  ];
  const ctx = createContext(rows, [checking, cardOf("card-nb", "Bank Norwegian"), cardOf("card-other", "OP")], today);

  it("groups the bills by issuer, with sum, count, last payment and the reason; a bill from the card's first day on is of a card not connected", () => {
    expect(missingCardPurchases(ctx, range)).toEqual([
      { issuer: "Morrow Bank", cents: 60000, count: 3, lastDate: "2026-09-05", reason: "not_connected", since: null },
      { issuer: "Bank Norwegian", cents: 53000, count: 3, lastDate: "2026-08-31", reason: "before_history", since: "2026-09-01" },
      { issuer: "SEB Kort", cents: 40000, count: 2, lastDate: "2026-08-12", reason: "not_connected", since: null },
      { issuer: "Bank Norwegian", cents: 15000, count: 2, lastDate: "2026-09-15", reason: "not_connected", since: null },
      { issuer: "Resurs Bank", cents: 9000, count: 1, lastDate: "2026-07-02", reason: "not_connected", since: null },
      { issuer: "Entercard", cents: 6000, count: 1, lastDate: "2026-07-15", reason: "not_connected", since: null },
    ]);
  });

  it("Tietojen laatu's title and Yhteenveto's Korttilaskuissa on are one sum, and Yhteenveto names the two largest issuers", () => {
    const signal = dataQualityReport(ctx, range).signals.find((s) => s.id === "card_bills")!;
    const questions = buildQuestions(ctx, range, NO_INPUTS);
    expect(signal.cents).toBe(183000);
    expect(questions.cardBillCents).toBe(signal.cents);
    expect(signal.title).toBe(`Korttilaskuja ${formatEur(questions.cardBillCents, false)} ilman ostoja`);
    // Bank Norwegian's two rows are one issuer: 680 euros, ahead of Morrow's 600
    expect(questions.cardBillIssuers).toEqual(["Bank Norwegian", "Morrow Bank"]);
    expect(signal.cardPurchases).toEqual(missingCardPurchases(ctx, range));
  });

  it("a card of another issuer does not connect the bills of this one, and no bills leave no signal", () => {
    const other = createContext(rows, [checking, cardOf("card-nb", "OP")], today);
    expect(missingCardPurchases(other, range).filter((m) => m.issuer === "Bank Norwegian")).toMatchObject([{ reason: "not_connected", since: null, cents: 68000 }]);
    expect(dataQualityReport(createContext([], [checking], today), range).signals.some((s) => s.id === "card_bills")).toBe(false);
  });

  describe("which connected card is of an issuer", () => {
    /** The reasons of one issuer's bill of March, with one card account that has rows from 1.9.2026. */
    const reasonsOf = (counterparty: string, card: Account) => {
      const c = createContext([bill(counterparty, "2026-03-05", 100), ...cardRows(card.id)], [checking, card], today);
      return missingCardPurchases(c, range).map((m) => m.reason);
    };
    it("takes the issuer's own names as whole words, in the bank or the card's name", () => {
      expect(reasonsOf("Bank Norwegian AB", cardOf("c", "Bank Norwegian"))).toEqual(["before_history"]);
      expect(reasonsOf("Bank Norwegian AB", cardOf("c", null, "Norwegian"))).toEqual(["before_history"]);
      expect(reasonsOf("Entercard Group AB", cardOf("c", null, "Entercard Platinum"))).toEqual(["before_history"]);
      expect(reasonsOf("Nordea Rahoitus Suomi Oy", cardOf("c", "Nordea", "Gold"))).toEqual(["before_history"]);
    });
    it("a card named only Card or Bank, or by a generic word, connects no issuer", () => {
      for (const generic of ["Card", "Bank", "Visa", "Gold"]) {
        expect(reasonsOf("Entercard Group AB", cardOf("c", null, generic)), generic).toEqual(["not_connected"]);
        expect(reasonsOf("Resurs Bank AB", cardOf("c", null, generic)), generic).toEqual(["not_connected"]);
        expect(reasonsOf("Nordea Rahoitus Suomi Oy", cardOf("c", null, generic)), generic).toEqual(["not_connected"]);
      }
      // a longer word that holds the issuer's name is another word
      expect(reasonsOf("Nordea Rahoitus Suomi Oy", cardOf("c", "Nordean Pankki", "Kulta"))).toEqual(["not_connected"]);
    });
    it("SEB is SEB Kort only with a card word or the issuer's name", () => {
      expect(reasonsOf("SEB Kort Bank Ab", cardOf("c", "SEB", "Platinum"))).toEqual(["not_connected"]);
      expect(reasonsOf("SEB Kort Bank Ab", cardOf("c", "SEB", "Eurocard"))).toEqual(["before_history"]);
      expect(reasonsOf("SEB Kort Bank Ab", cardOf("c", "SEB Kort"))).toEqual(["before_history"]);
      expect(reasonsOf("SEB Kort Bank Ab", cardOf("c", "Skandinaviska Enskilda Banken", "Mastercard"))).toEqual(["not_connected"]);
    });
  });
});
