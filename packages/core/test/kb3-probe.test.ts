/**
 * Probe: foreign brands a Finnish household pays. Every added brand with a typical made-up descriptor, the narrowed
 * patterns and their false friends, the brands that must win over a broader one, own money moved abroad, the car brands
 * by sum, a user's rule, and brands that stay out. Made-up rows only.
 *
 * A row is filed as the pipeline would for a business row: the built-in rules, the card code, then the lexicon when
 * nothing else decided (money out only), so a brand may sit in either file.
 */
import { describe, expect, it } from "vitest";
import { categorize, compileRules, type CategorizeInput } from "../src/categorize.ts";
import { lexiconCategory } from "../src/lexicon.ts";
import { LEXICON } from "../src/lexicon-data.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import type { CategoryRule } from "../src/types.ts";

const builtin = compileRules([]);
const TERMINAL = "12345678 HELSINKI";
const PAYEE_ACCOUNT = "FI4950009420028731";
const FOREIGN_ACCOUNT = "LT123250012345678901";
const cents = (euros: number) => Math.round(euros * 100);

/** A card purchase: the payee field is the shop's text, no payee account. */
const card = (text: string, euros: number, mcc: string | null = null): CategorizeInput => ({
  merchant: normalizeMerchant(text, null),
  counterparty: text,
  description: null,
  mcc,
  amountCents: cents(euros),
});
/** A credit transfer to or from an account, with the payer's message. */
const transfer = (name: string, message: string, euros: number, iban = PAYEE_ACCOUNT): CategorizeInput => ({
  merchant: normalizeMerchant(name, message),
  counterparty: name,
  description: message,
  mcc: null,
  reference: null,
  counterpartyIban: iban,
  amountCents: cents(euros),
});
/** MobilePay booked as a card purchase to a person. */
const mobilePay = (name: string, euros: number): CategorizeInput => ({
  merchant: normalizeMerchant(`MOB.PAY*${name}`, TERMINAL),
  counterparty: `MOB.PAY*${name}`,
  description: TERMINAL,
  mcc: null,
  amountCents: cents(euros),
});

/** Rules, then the card code, then the lexicon's company rows on money out. */
function file(row: CategorizeInput, rules = builtin): string {
  const result = categorize(row, rules);
  if (result.source !== "default" || row.amountCents >= 0) return result.category;
  return lexiconCategory(row)?.category ?? result.category;
}

describe("every added brand files under its category", () => {
  it.each([
    // brands checked to sell to Finnish households
    ["KFC TAMPERE KESKUSTA", -12.9, "restaurants"],
    ["TACO BELL HELSINKI", -14.5, "restaurants"],
    ["SKODA SERVICE ESIMERKKI", -189, "car"],
    ["PEUGEOT", -95, "car"],
    ["RENAULT", -240, "car"],
    ["MERCEDES-BENZ", -310, "car"],
    ["MERCEDES BENZ", -310, "car"],
    ["AUDI", -420, "car"],
    ["HONDA", -150, "car"],
    ["CITROEN", -120, "car"],
    ["CITROËN", -120, "car"],
    ["AEGEAN AIRLINES", -289, "travel"],
    ["AEGEAN AIR 3901234567", -289, "travel"],
    ["AGODA COMPANY PTE", -412, "travel"],
    ["AGODA.COM", -412, "travel"],
    ["TRIP.COM", -356, "travel"],
    ["TRIP.COM INTERNATIONAL", -356, "travel"],
    ["OPODO LIMITED", -199, "travel"],
    ["ABOUT YOU GMBH", -59.9, "shopping"],
    ["ABOUTYOU", -59.9, "shopping"],
    ["NELLY.COM", -44.95, "shopping"],
    ["CDON.COM", -29.9, "shopping"],
    ["CDON", -29.9, "shopping"],
    ["EVENTBRITE", -35, "entertainment"],
    ["UBISOFT STORE", -69.99, "entertainment"],
    ["ZOOM.US 888-799-9666", -15.99, "subscriptions"],
    ["ZOOM VIDEO COMM", -15.99, "subscriptions"],
    ["MIDJOURNEY INC", -10, "subscriptions"],
    ["PERPLEXITY.AI", -20, "subscriptions"],
    ["PPLX", -20, "subscriptions"],
    ["OVH SAS", -6.99, "subscriptions"],
    ["OVHCLOUD", -6.99, "subscriptions"],
    ["AWS EMEA", -3.12, "subscriptions"],
    ["AMAZON WEB SERVICES", -3.12, "subscriptions"],
    ["GOOGLE *CLOUD", -4.5, "subscriptions"],
    ["GOOGLE CLOUD EMEA", -4.5, "subscriptions"],
    ["PROTON AG", -9.99, "subscriptions"],
    ["PROTON.ME", -9.99, "subscriptions"],
    ["MULLVAD VPN AB", -5, "subscriptions"],
    ["ESET SPOL SRO", -39.9, "subscriptions"],
    ["BETWAY", -20, "gambling"],
    ["BETFAIR", -20, "gambling"],
    ["COMEON", -25, "gambling"],
    ["COMEON!", -25, "gambling"],
    ["MR GREEN", -25, "gambling"],
    ["MRGREEN", -25, "gambling"],
    ["WESTERN UNION", -150, "p2p"],
    ["WESTERN UNION 1234567890", -150, "p2p"],
    // brands the lists missed
    ["BOLT FOOD", -23.4, "food_delivery"],
    ["VINTED UAB", -18.5, "shopping"],
    ["RENTALCARS.COM", -234, "travel"],
    ["AIRALO", -9, "telecom"],
    ["EUROWINGS", -129, "travel"],
    ["LOT POLISH AIRLINES", -189, "travel"],
    ["LOT.COM", -189, "travel"],
    ["XBOX", -59.99, "entertainment"],
    ["NOTINO", -32.9, "personal_care"],
    ["RITUALS COSMETICS", -27.5, "personal_care"],
    ["HEMTEX", -49.9, "home"],
    ["BUBBLEROOM", -39.95, "shopping"],
    ["FYNDIQ", -19.9, "shopping"],
    ["DISCORD.COM", -9.99, "subscriptions"],
    ["DISCORD NITRO", -9.99, "subscriptions"],
    // sells to Finland
    ["ASOS.COM", -45, "shopping"],
  ] as const)("%s %d → %s", (text, euros, expected) => {
    expect(file(card(text, euros))).toBe(expected);
  });

  it("Toyota's finance company is a loan payment, its refund or money in is not borrowing", () => {
    expect(file(transfer("TOYOTA FINANCIAL SERVICES", "SOPIMUS 123456 ERA 10/2026", -320))).toBe("loans");
    for (const [message, euros] of [["HYVITYS", 45], ["PALAUTUS LIIKAA MAKSETTU", 320], ["SOPIMUS 123456", 320]] as const) {
      expect(["loans", "credit_draw"], message).not.toContain(file(transfer("TOYOTA FINANCIAL SERVICES", message, euros)));
    }
  });

  it("Paysafecard is a payment service in the lexicon and never a payment to a person", () => {
    expect(LEXICON.some((entry) => entry.kind === "intermediary" && entry.names.includes("PAYSAFECARD"))).toBe(true);
    expect(file(card("PAYSAFECARD", -25))).not.toBe("p2p");
    expect(file(card("PAYSAFECARD STEAM", -25))).toBe("entertainment");
    expect(lexiconCategory({ merchant: "PAYSAFECARD", counterparty: "PAYSAFECARD", description: null, counterpartyIban: null })?.category ?? null).not.toBe("p2p");
  });

  it("a refund from a shop takes the shop's category, and money in from Vinted stays a sale", () => {
    expect(file(card("ASOS.COM", 45))).toBe("shopping");
    expect(file(card("NELLY.COM", 44.95))).toBe("shopping");
    expect(file(transfer("VINTED UAB", "TILITYS 2610", 18.5))).toBe("sales");
  });
});

describe("a narrowed pattern leaves its false friend alone", () => {
  it.each([
    ["bare WISE on a card", card("WISE", -12), "transfer"],
    ["WISE inside a word", card("STREETWISE OY", -12), "transfer"],
    ["a person named Wise on a transfer", transfer("WISE MATTI", "Siirto-maksu", -40), "transfer"],
    ["Nelly by MobilePay", mobilePay("NELLY VIRTANEN", -25), "shopping"],
    ["Nelly on a transfer", transfer("VIRTANEN NELLY", "Siirto-maksu", -25), "shopping"],
    ["PROTON in a sentence", { ...card("TIEDEKESKUS ESIMERKKI", -18), description: "PROTON JA NEUTRONI NAYTTELY" }, "subscriptions"],
    ["Proton by MobilePay", mobilePay("PROTON MEIKALAINEN", -15), "subscriptions"],
    ["ZOOM alone", card("ZOOM", -49), "subscriptions"],
    ["ZOOM as a shop word", card("ZOOM KAMERAT ESIMERKKI", -49), "subscriptions"],
    ["ABOUT YOU as a phrase", { ...card("ESIMERKKI OY", -20), description: "ALL ABOUT YOU KIRJA" }, "shopping"],
    ["ABOUT YOU in a message", transfer("MEIKALAINEN MAIJA", "THINKING ABOUT YOU", -20), "shopping"],
    ["TRIP without .COM", card("TRIP", -30), "travel"],
    ["TRIP as a word of a name", card("ESIMERKKI TRIP OY", -30), "travel"],
    ["LOT alone", card("LOT", -30), "travel"],
    ["LOT in a message", transfer("ESIMERKKI HUUTOKAUPAT OY", "LOT 14", -30), "travel"],
    ["COME ON as two words", card("COME ON ESIMERKKI", -25), "gambling"],
    ["Come On by MobilePay", mobilePay("COME ON", -25), "gambling"],
    ["MERCEDES alone", card("MERCEDES", -60), "car"],
    ["Mercedes by MobilePay", mobilePay("MERCEDES KORHONEN", -60), "car"],
    ["AEGEAN alone", card("AEGEAN", -60), "travel"],
    ["RITUALS alone", { ...card("ESIMERKKI OY", -30), description: "RITUALS OF THE NORTH" }, "personal_care"],
    ["DISCORD as a word", { ...card("ESIMERKKI OY", -30), description: "DISCORD KIRJA" }, "subscriptions"],
    ["KIA alone", card("KIA", -80), "car"],
    ["Kia by MobilePay", mobilePay("KIA VIRTANEN", -80), "car"],
    ["OVH inside another word", card("MOVHUB OY", -12), "subscriptions"],
    ["ESET inside a street name", card("ESIMERKKI OY ESETINKATU 5", -12), "subscriptions"],
  ] as const)("%s is not %s", (_name, row, wrong) => {
    expect(file(row)).not.toBe(wrong);
  });

  it("a person named like a brand, paid by MobilePay or transfer, stays a payment to a person", () => {
    for (const name of ["NELLY VIRTANEN", "PROTON MEIKALAINEN", "WISE MATTI", "MERCEDES KORHONEN", "KIA VIRTANEN", "COME ON"]) {
      expect(file(mobilePay(name, -20)), name).toBe("p2p");
    }
    for (const name of ["VIRTANEN NELLY", "MEIKALAINEN PROTON", "WISE MATTI", "KORHONEN MERCEDES", "VIRTANEN KIA"]) {
      expect(file(transfer(name, "Siirto-maksu", -20)), name).toBe("p2p");
    }
  });

  it("a brand word next to a Finnish street or place is the brand when it stands whole", () => {
    expect(file(card("KFC MANNERHEIMINTIE 5 HELSINKI", -11.9))).toBe("restaurants");
    expect(file(card("HONDA PITKAKATU 4 TAMPERE", -150))).toBe("car");
    expect(file(card("ESET SPOL SRO BRATISLAVA", -39.9))).toBe("subscriptions");
  });
});

describe("a narrow brand wins over the broad rule", () => {
  it.each([
    ["BOLT FOOD", "food_delivery"],
    ["BOLT.EU/F/2610151234", "food_delivery"],
    ["BOLT.EU/R/2610151234", "transport"],
    ["BOLT", "transport"],
    ["AWS EMEA", "subscriptions"],
    ["AMAZON WEB SERVICES EMEA SARL", "subscriptions"],
    ["AMAZON.DE", "shopping"],
    ["AMZN MKTP DE", "shopping"],
    ["AMAZON PRIME", "subscriptions"],
    ["GOOGLE CLOUD EMEA", "subscriptions"],
    ["GOOGLE *YOUTUBE", "subscriptions"],
    ["MICROSOFT *XBOX", "subscriptions"],
    ["XBOX", "entertainment"],
  ] as const)("%s → %s", (text, expected) => {
    expect(file(card(text, -19.9))).toBe(expected);
  });
});

describe("own money moved abroad is a transfer both ways", () => {
  it.each([
    ["a top-up by card", card("REVOLUT**1234*", -200)],
    ["a transfer to the bank", transfer("REVOLUT BANK UAB", "TOP UP", -200, FOREIGN_ACCOUNT)],
    ["money back from the bank", transfer("REVOLUT BANK UAB", "REVOLUT", 200, FOREIGN_ACCOUNT)],
    ["a card top-up of Wise", card("WISE EUROPE SA", -300)],
    ["money in from Wise", transfer("WISE EUROPE SA", "WISE", 300, "BE12345678901234")],
    ["Wise Payments out", transfer("WISE PAYMENTS LIMITED", "P12345678", -150, "GB12345678901234567890")],
    ["Wise Payments in", transfer("WISE PAYMENTS LIMITED", "P12345678", 150, "GB12345678901234567890")],
    ["TransferWise out (older rows)", card("TRANSFERWISE", -80)],
    ["TransferWise in", transfer("TRANSFERWISE LTD", "TRANSFERWISE", 80, "GB12345678901234567890")],
  ] as const)("%s", (_name, row) => {
    expect(file(row)).toBe("transfer");
  });

  it("is never a spending category, and Western Union out is money sent to a person", () => {
    expect(file(card("REVOLUT**1234*", -200))).not.toBe("p2p");
    expect(file(transfer("WESTERN UNION", "MONEY TRANSFER 1234567890", -150))).toBe("p2p");
  });
});

describe("a car brand by the sum", () => {
  it.each([
    ["AUDI", -1499.99, "car"],
    ["AUDI", -1500, "vehicle_purchase"],
    ["SKODA", -24_900, "vehicle_purchase"],
    ["CITROËN", -18_000, "vehicle_purchase"],
    ["MERCEDES-BENZ", -1500, "vehicle_purchase"],
    ["PEUGEOT", -89, "car"],
    ["HONDA", -1499, "car"],
  ] as const)("%s %d → %s", (text, euros, expected) => {
    expect(file(card(text, euros))).toBe(expected);
  });
});

describe("precedence stays", () => {
  const user = (pattern: string, category: string): CategoryRule[] => [{ field: "any", pattern, category, priority: 10 }];

  it("a user's rule wins over every added brand", () => {
    expect(categorize(card("REVOLUT**1234*", -200), compileRules(user("Revolut", "savings")))).toMatchObject({ category: "savings", byUser: true });
    expect(categorize(card("BOLT FOOD", -23), compileRules(user("Bolt Food", "restaurants")))).toMatchObject({ category: "restaurants", byUser: true });
    expect(categorize(card("WESTERN UNION", -150), compileRules(user("Western Union", "gifts_donations")))).toMatchObject({ category: "gifts_donations", byUser: true });
    expect(categorize(card("AUDI", -2000), compileRules(user("Audi", "car")))).toMatchObject({ category: "car", byUser: true });
  });

  it("a purpose word beats the brand", () => {
    expect(file(transfer("TOYOTA FINANCIAL SERVICES", "LAINANLYHENNYS 10/2026", -320))).toBe("loans");
  });
});

describe("brands left out stay as they are today", () => {
  // the values the rules gave before the foreign brands were added
  it.each([
    ["NARVESEN", card("NARVESEN OSLO S", -4.5), "other"],
    ["OKQ8", card("OKQ8 HAPARANDA", -60), "other"],
    ["N26", transfer("N26 BANK GMBH", "TOP UP", -200, "DE12345678901234567890"), "transfer"],
  ] as const)("%s", (_name, row, today) => {
    expect(file(row)).toBe(today);
  });
});
