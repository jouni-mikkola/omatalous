import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "../src/merchant.ts";

describe("normalizeMerchant", () => {
  it.each([
    ["K-MARKET KAMPPI HELSINKI", "K-Market"],
    ["K-SUPERMARKET HERTTONIEMI", "K-Supermarket"],
    ["PAYPAL *SPOTIFY P2A1B3C4 STOCKHOLM SE", "Spotify"],
    ["WOLT HELSINKI FI", "Wolt"],
    ["APPLE.COM/BILL ITUNES.COM IE", "Apple"],
    ["MEHILÄINEN OY", "Mehiläinen"],
    ["MEHILAINEN LASKUTUS", "Mehiläinen"],
    ["FITNESS24SEVEN", "Fitness24Seven"],
    ["Korttiosto 12.03. NESTE EXPRESS VANTAA", "Neste"],
    ["UBER *EATS PENDING", "Uber Eats"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeMerchant(null, raw)).toBe(expected);
  });

  it("title-cases unknown merchants and keeps Nordic letters", () => {
    expect(normalizeMerchant("KAHVILA PÄIVÄNSÄDE OY", null)).toBe("Kahvila Päivänsäde Oy");
    expect(normalizeMerchant("SUMUP *TORIKAHVILA 4F2A9B ESPOO", null)).toBe("Torikahvila");
  });

  it("prefers counterparty, falls back to description", () => {
    expect(normalizeMerchant("", "NETFLIX.COM")).toBe("Netflix");
    expect(normalizeMerchant(null, null)).toBe("Tuntematon");
  });
});

describe("surnames that are towns", () => {
  it("keeps people's surnames but still strips the town after a store name", () => {
    expect(normalizeMerchant("MATTI LAHTI", "MOBILEPAY")).not.toBe(normalizeMerchant("MATTI SALO", "MOBILEPAY"));
    expect(normalizeMerchant(null, "K-MARKET KAMPPI HELSINKI")).toBe(normalizeMerchant(null, "K-MARKET KAMPPI"));
    expect(normalizeMerchant(null, "PRISMA SYKE LAHTI")).toBe(normalizeMerchant(null, "PRISMA SYKE"));
  });
});

describe("card texts in CSV exports", () => {
  it.each([
    ["KORTTIOSTO 4581XXXXXXXX2241 K-CITYMARKET JUMBO", "K-Citymarket"],
    ["KORTTIOSTO 4581********2241 TUKKATALO TIKKURILA", "Tukkatalo"],
    ["4581 XXXX XXXX 2241 MAMMAN PULLAPUOTI", "Mamman Pullapuoti"],
    ["XXXXXXXXXXXX2241 SALON VILMA", "Salon Vilma"],
    ["123456 7788 KAHVILA ILO", "Kahvila Ilo"],
  ])("%s → %s", (raw, expected) => expect(normalizeMerchant(null, raw)).toBe(expected));

  it("keeps a name that is only digits and letters together", () => {
    expect(normalizeMerchant(null, "24STORAGE VANTAA")).toBe("24storage");
    expect(normalizeMerchant(null, "ST1 HAKKILA")).toBe("St1");
    expect(normalizeMerchant(null, "XXL SPORTS JUMBO")).toBe("Xxl Sports");
  });
});

describe("longer names", () => {
  it("keeps up to four words and 40 characters, whole words only", () => {
    expect(normalizeMerchant("AS OY VANTAAN HELMIPOLKU", "HOITOVASTIKE")).toBe("As Oy Vantaan Helmipolku");
    expect(normalizeMerchant("VANTAAN JA KERAVAN HYVINVOINTIALUE", null)).toBe("Vantaan Ja Keravan Hyvinvointialue");
    expect(normalizeMerchant("LAAKSONEN MIKKO JA ANNA JA LAPSET", null)).toBe("Laaksonen Mikko Ja Anna");
    expect(normalizeMerchant("POHJOIS-SAVON SAIRAANHOITOPIIRIN KUNTAYHTYMÄ LASKUTUS", null)).toBe("Pohjois-Savon Sairaanhoitopiirin");
    expect(normalizeMerchant("SAIRAANHOITOPIIRINKUNTAYHTYMÄNLASKUTUSPALVELUKESKUS", null)).toHaveLength(40);
  });
});

describe("districts and malls after the name", () => {
  it.each([
    ["ALEPA KALLIO", "Alepa"],
    ["LINDEX JUMBO", "Lindex"],
    ["BR-LELUT JUMBO", "Br-Lelut"],
    ["KAHVILA ILO ITÄKESKUS HELSINKI", "Kahvila Ilo"],
    ["ASIA-PUOTI TIKKURILA", "Asia-Puoti"],
    ["BOWLINGCENTER JUMBO", "Bowlingcenter"],
    ["SUSHIBAR TAPIOLA ESPOO", "Sushibar"],
    ["PIZZERIA ROMA ISO OMENA", "Pizzeria Roma"],
    ["KIRJAKAUPPA SELLO", "Kirjakauppa"],
    ["HESBURGER MYYRMÄKI", "Hesburger"],
    ["KUKKAKAUPPA KAUPPAKESKUS REDI", "Kukkakauppa"],
    ["MUUMIMAAILMA NAANTALI", "Muumimaailma"],
  ])("%s → %s", (raw, expected) => expect(normalizeMerchant(null, raw)).toBe(expected));

  it("does not strip a place that is the whole name or a person's surname", () => {
    expect(normalizeMerchant("TIKKURILA OYJ", null)).toBe("Tikkurila Oyj");
    expect(normalizeMerchant(null, "JUMBO")).toBe("Jumbo");
    expect(normalizeMerchant("MATTI KALLIO", "MOBILEPAY")).toBe("Matti Kallio");
    expect(normalizeMerchant("ANNA MALMI", "MOBILEPAY")).toBe("Anna Malmi");
    // the genitive is part of the name
    expect(normalizeMerchant(null, "TIKKURILAN KIOSKI")).toBe("Tikkurilan Kioski");
  });

  it("keeps a burger chain apart from the streaming service", () => {
    expect(normalizeMerchant(null, "MAX BURGERS STOCKHOLM")).toBe("Max Burgers");
    expect(normalizeMerchant(null, "HBOMAX.COM")).toBe("Max");
  });

  it("is deterministic", () => {
    const raw = "KORTTIOSTO 4581XXXXXXXX2241 K-MARKET TIKKURILA";
    expect(normalizeMerchant(null, raw)).toBe(normalizeMerchant(null, raw));
  });
});
