import { describe, expect, it } from "vitest";
import { cardMasks, cardName, cardsOwe, maskedNames } from "../src/components/holdings/holding-rows.ts";

const account = (id: string, name = id, mask: string | null = null) => ({ id, name, mask });

describe("maskedNames", () => {
  it("gives a mask to each of the accounts that share a name, and to no other", () => {
    const masks = maskedNames([account("a", "Käyttötili", "1234"), account("b", "Käyttötili", "5678"), account("c", "Säästötili", "9999")]);
    expect([...masks]).toEqual([["a", "1234"], ["b", "5678"]]);
  });

  it("compares names without case and extra spaces", () => {
    const masks = maskedNames([account("a", "Käyttötili", "1234"), account("b", " käyttötili  ", "5678")]);
    expect([...masks.keys()]).toEqual(["a", "b"]);
  });

  it("leaves out an account that has no number, and a name that stands alone", () => {
    expect([...maskedNames([account("a", "Käyttötili", "1234"), account("b", "Käyttötili", null)])]).toEqual([["a", "1234"]]);
    expect(maskedNames([account("a", "Käyttötili", "1234")]).size).toBe(0);
    expect(maskedNames([]).size).toBe(0);
  });
});

describe("cardName", () => {
  it("drops the type a bank adds in brackets, in either case and with the spaces around it", () => {
    for (const [name, plain] of [
      ["Esimerkkikortti Gold (credit)", "Esimerkkikortti Gold"],
      ["Esimerkkikortti (debit)", "Esimerkkikortti"],
      ["Esimerkkikortti (CREDIT)", "Esimerkkikortti"],
      ["Esimerkkikortti ( Credit Card )", "Esimerkkikortti"],
      ["Esimerkkikortti(luotto)", "Esimerkkikortti"],
      ["  Esimerkkikortti   (kredit)  ", "Esimerkkikortti"],
    ] as const) {
      expect(cardName(name), name).toBe(plain);
    }
  });

  it("keeps a bracket that is not a type: the owner of a shared card, a word of the name", () => {
    for (const name of ["Esimerkkikortti (Eero)", "Nordea Gold (esimerkki)", "Esimerkkikortti (credits)", "Esimerkkikortti (credit limit)", "Esimerkkikortti Credit"]) {
      expect(cardName(name), name).toBe(name);
    }
  });

  it("takes the type out in front of an owner's name too, and out of the middle of a name", () => {
    expect(cardName("Esimerkkikortti (credit) (Eero)")).toBe("Esimerkkikortti (Eero)");
    expect(cardName("Esimerkki (debit) Gold")).toBe("Esimerkki Gold");
  });

  it("never leaves a card without a name", () => {
    expect(cardName("(credit)")).toBe("(credit)");
    expect(cardName("")).toBe("");
  });
});

describe("cardMasks", () => {
  it("gives the last four characters of the number to each of the cards that share a name, and to no other", () => {
    const masks = cardMasks([account("a", "Esimerkkikortti", "•••• 1234"), account("b", "Esimerkkikortti", "•••• 5678"), account("c", "Toinen kortti", "•••• 9999")]);
    expect([...masks]).toEqual([["a", "1234"], ["b", "5678"]]);
  });

  it("compares the names the page shows, so the type a bank adds in brackets does not tell two cards apart", () => {
    const masks = cardMasks([account("a", "Esimerkkikortti (credit)", "•••• 1234"), account("b", "Esimerkkikortti", "•••• 5678")]);
    expect([...masks.keys()]).toEqual(["a", "b"]);
  });

  it("leaves out a card the bank gave no digits for, and a card with a name of its own", () => {
    expect([...cardMasks([account("a", "Esimerkkikortti", "•••• 1234"), account("b", "Esimerkkikortti", null)])]).toEqual([["a", "1234"]]);
    expect(cardMasks([account("a", "Esimerkkikortti", "•••• 1234")]).size).toBe(0);
  });
});

describe("cardsOwe", () => {
  const card = (usedCents: number | null) => ({ usedCents });

  it("is true when a card has something used, and false for a card at zero, one without a balance and no card", () => {
    expect(cardsOwe([card(0), card(12_000)])).toBe(true);
    expect(cardsOwe([card(1)])).toBe(true);
    expect(cardsOwe([card(0), card(null)])).toBe(false);
    expect(cardsOwe([])).toBe(false);
  });
});
