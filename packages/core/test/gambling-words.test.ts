/**
 * Gambling is known by its operators, its words and its merchant codes (wording-gambling.ts). The brands named
 * "Pelikasino" and "Onnenpyörä" are made up; the others are on the list.
 */
import { describe, expect, it } from "vitest";
import { categorize, compileRules } from "../src/categorize.ts";

const rules = compileRules([]);
const cat = (counterparty: string, euros: number, extra: { mcc?: string; description?: string; iban?: string } = {}) =>
  categorize(
    { merchant: counterparty, counterparty, description: extra.description ?? null, mcc: extra.mcc ?? null, counterpartyIban: extra.iban ?? null, amountCents: euros * 100 },
    rules,
  ).category;

describe("gambling by its merchant code", () => {
  it.each(["7995", "7800", "7801", "7802", "9406"])("a brand no list names, with code %s, is gambling", (mcc) => {
    expect(cat("ONNENPYORA LTD", -20, { mcc })).toBe("gambling");
  });
});

describe("gambling by its operator", () => {
  it.each([
    ["Veikkaus at a kiosk, with the kiosk's code", "VEIKKAUS OY", "5994"],
    ["an operator by its legal name alone", "PROZONE LIMITED", undefined],
    ["the same, paid with a code of its own", "PROZONE LIMITED", "7372"],
    ["a brand of the same company", "SUPERNOPEA.COM", undefined],
    ["Paf", "PAF", undefined],
  ])("%s", (_name, counterparty, mcc) => {
    expect(cat(counterparty, -40, { mcc })).toBe("gambling");
  });
});

describe("gambling by its word", () => {
  it.each([
    ["a made-up operator under its legal name, paid by card with no code", "PELIKASINO HOLDINGS LTD", "KORTTIOSTO 01.09"],
    ["an inflected word", "POKERI ONLINE LTD", "VERKKOMAKSU"],
    ["slot machines", "KOLIKKOPELI LTD", "KORTTIOSTO 01.09"],
    ["a licence holder's game", "EUROJACKPOT", "VERKKOMAKSU"],
  ])("%s", (_name, counterparty, description) => {
    expect(cat(counterparty, -50, { description })).toBe("gambling");
  });

  it("a brand written with a digit", () => {
    expect(cat("BET365", -30)).toBe("gambling");
    expect(cat("NETBET", -30)).toBe("gambling");
    expect(cat("1XBET", -30)).toBe("gambling");
  });

  it("a word with a code no other category has", () => {
    expect(cat("ONNENPYORA SLOTS", -20, { mcc: "7299" })).toBe("gambling");
  });

  it("a word in the message of a card payment", () => {
    expect(cat("ONNENPYORA LTD", -25, { description: "VERKKOMAKSU RAHAPELIT" })).toBe("gambling");
  });
});

describe("near misses", () => {
  it("Casino Bar with a bar's code stays a bar", () => {
    expect(cat("CASINO BAR", -12, { mcc: "5813" })).toBe("restaurants");
  });

  it("a word with no card payment is none: a transfer or an invoice", () => {
    for (const name of ["SALON SPINS", "SLOTS PARKING", "BINGO PIZZERIA", "BET ASKEL", "KASINO HOLDINGS LTD"]) expect(cat(name, -30)).not.toBe("gambling");
    expect(cat("BINGO PIZZERIA", -30, { iban: "FI4950009420028730" })).not.toBe("gambling");
  });

  it("a game's name yields to another category's code", () => {
    expect(cat("KENO PIZZA", -14, { mcc: "5814" })).toBe("restaurants");
    expect(cat("CASINO", -14, { mcc: "7999" })).not.toBe("gambling");
  });

  it("a word inside another word is none", () => {
    for (const name of ["BETONIVALU OY", "SPINNING STUDIO", "TOTOAJA OY"]) expect(cat(name, -30, { description: "KORTTIOSTO 01.09" })).not.toBe("gambling");
  });

  it("PAF inside a longer word is no operator", () => {
    expect(cat("PAFFINEN KAHVILA", -6)).not.toBe("gambling");
    expect(cat("TOTOAJA OY", -6)).not.toBe("gambling");
  });

  it("a payment service alone is no evidence", () => {
    expect(cat("TRUSTLY", -40)).not.toBe("gambling");
    expect(cat("ZIMPLER", -20)).not.toBe("gambling");
  });

  it.each([
    ["Trustly to an online shop", "TRUSTLY", "VERKKOKAUPPA ILO OY VERKKOMAKSU", -89],
    ["Trustly to a broker, a deposit", "TRUSTLY", "ESIMERKKI SECURITIES AB TALLETUS", -500],
    ["Trustly from a broker, a withdrawal", "TRUSTLY", "ESIMERKKI SECURITIES AB NOSTO", 500],
    ["a Trustly refund from a shop", "TRUSTLY GROUP AB", "PALAUTUS VERKKOKAUPPA ILO OY", 45],
    ["Zimpler to a web store", "ZIMPLER", "KUKKAKAUPPA ILO VERKKOMAKSU", -35],
  ])("%s is no gambling: a payment service alone is never evidence", (_name, counterparty, description, euros) => {
    const category = cat(counterparty, euros, { description });
    expect(category).not.toBe("gambling");
    expect(category).not.toBe("gambling_in");
  });

  it("a payment service row is gambling when it names the operator", () => {
    expect(cat("TRUSTLY", -50, { description: "PROZONE LIMITED" })).toBe("gambling");
    expect(cat("ZIMPLER", -20, { description: "ONNENPYORA LTD", mcc: "7995" })).toBe("gambling");
  });

  it("a user's rule on an operator wins", () => {
    const own = compileRules([{ field: "merchant", pattern: "Prozone", category: "entertainment", priority: 10 }]);
    expect(categorize({ merchant: "PROZONE LIMITED", counterparty: "PROZONE LIMITED", description: null, mcc: null, amountCents: -4000 }, own).category).toBe("entertainment");
  });
});
