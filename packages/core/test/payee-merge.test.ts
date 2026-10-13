/**
 * One payee is one payee: a payment service is seen through to the shop behind it, a brand has one name whatever the
 * spelling, and a company form at the end is no part of a name. Every name here is made up.
 */
import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "../src/merchant.ts";

const name = (raw: string) => normalizeMerchant(null, raw);

describe("a payment service is seen through", () => {
  it("makes the shop behind the service the payee", () => {
    expect(name("TRUSTLY GROUP AB VEIKKAUS OY")).toBe("Veikkaus");
    expect(name("ZIMPLER OY KAHVILA ILO OY")).toBe("Kahvila Ilo Oy");
    expect(name("BRITE AB KAHVILA ILO OY")).toBe("Kahvila Ilo Oy");
    expect(name("ADYEN KAHVILA ILO")).toBe("Adyen Kahvila Ilo");
    expect(name("ADYEN*KAHVILA ILO")).toBe("Kahvila Ilo");
    expect(name("VIPPS*KAHVILA ILO")).toBe("Kahvila Ilo");
    expect(name("VIPPS MOBILEPAY AS KAHVILA ILO OY")).toBe("Kahvila Ilo Oy");
  });

  it.each([
    ["TRUSTLY", "Trustly"], ["Trustly Group AB", "Trustly"], ["TRUSTLY GROUP AB STOCKHOLM SE", "Trustly"], ["Trustly Oy", "Trustly"],
    ["ZIMPLER", "Zimpler"], ["Zimpler Oy", "Zimpler"], ["ZIMPLER OY HELSINKI FI", "Zimpler"],
    ["BRITE", "Brite"], ["Brite AB", "Brite"], ["ADYEN", "Adyen"], ["ADYEN N.V.", "Adyen"], ["Adyen NV Amsterdam NL", "Adyen"],
    ["VIPPS", "Vipps"], ["Vipps AS", "Vipps"], ["VIPPS MOBILEPAY", "Vipps"], ["Vipps MobilePay AS", "Vipps"],
    ["PAYPAL", "PayPal"], ["Paypal Europe", "PayPal"], ["KLARNA", "Klarna"], ["Klarna Bank AB", "Klarna"], ["PAYTRAIL OYJ", "Paytrail"],
    ["PAYTRAIL OYJ HELSINKI", "Paytrail"], ["SUMUP", "SumUp"], ["ZETTLE", "Zettle"], ["STRIPE", "Stripe"], ["MOLLIE", "Mollie"], ["NETS", "Nets"],
  ])("a row naming only the service %s is the payee %s", (raw, expected) => expect(name(raw)).toBe(expected));

  it("does not take a payee whose name only begins with the letters of a service", () => {
    expect(name("Britex Oy")).toBe("Britex");
    expect(name("Adyenta")).toBe("Adyenta");
    expect(name("Trustlyne")).toBe("Trustlyne");
    expect(name("Trustlyne Oy Kauppa")).toBe("Trustlyne Oy Kauppa");
    expect(name("Zimplerit Oy")).toBe("Zimplerit");
    expect(name("Vippsala Oy")).toBe("Vippsala");
    expect(name("BRITEX OY KAHVILA ILO")).toBe("Britex Oy Kahvila Ilo");
  });

  it("keeps a person paid through MobilePay or Vipps", () => {
    expect(normalizeMerchant("EMMA KORHONEN", "VIPPS MOBILEPAY")).toBe("Emma Korhonen");
    expect(normalizeMerchant("EMMA KORHONEN", "MOBILEPAY")).toBe("Emma Korhonen");
  });
});

describe("brands", () => {
  it.each(["VEIKKAUS OY", "VEIKKAUS OY PELITILI", "VEIKKAUS.FI", "Veikkaus Oy Ab", "VEIKKAUS OY HELSINKI", "VEIKKAUS 12345"])(
    "%s is Veikkaus",
    (raw) => expect(name(raw)).toBe("Veikkaus"),
  );

  it.each([
    ["ALKO KAMPPI", "Alko"], ["BAUHAUS ESPOO", "Bauhaus"], ["STARK SUOMI OY", "Stark"], ["STARK OY", "Stark"], ["PUUILO OY", "Puuilo"],
    ["POWER FINLAND", "Power"], ["JYSK TURKU", "Jysk"], ["STADIUM OULU", "Stadium"], ["XXL SPORT", "XXL"], ["INTERSPORT OY", "Intersport"],
    ["SUBWAY KAMPPI", "Subway"], ["VATTENFALL OY", "Vattenfall"], ["ELENIA OY", "Elenia"], ["KELA", "Kela"], ["VEROHALLINTO", "Verohallinto"],
    ["TRAFICOM", "Traficom"], ["YLIOPISTON APTEEKKI HELSINKI", "Yliopiston Apteekki"], ["APPLE", "Apple"], ["Elisa Oyj", "Elisa"],
  ])("%s is %s", (raw, expected) => expect(name(raw)).toBe(expected));

  it("needs a word boundary", () => {
    expect(name("Powerpark Oy")).toBe("Powerpark");
    expect(name("Applebee Oy")).toBe("Applebee");
    expect(name("ABCDEF Oy")).toBe("Abcdef");
    expect(name("Starkala Oy")).toBe("Starkala");
    expect(name("Kelaaja")).toBe("Kelaaja");
    expect(name("ABC")).toBe("ABC");
  });

  it("leaves a person whose name is a brand's", () => {
    expect(name("KORHONEN ELISA")).toBe("Korhonen Elisa");
    expect(name("Stark Tony")).toBe("Stark Tony");
    expect(name("ELISA KORHONEN")).toBe("Elisa Korhonen");
  });
});

describe("a company form at the end", () => {
  it("is no part of the name, however many there are", () => {
    for (const raw of ["Yritys", "Yritys Oy", "Yritys Oyj", "YRITYS OY AB"]) expect(name(raw)).toBe("Yritys");
  });

  it("stays at the start, where it is the name", () => {
    expect(name("As Oy Esimerkkikatu 3")).toBe("As Oy Esimerkkikatu");
    expect(name("Asunto Oy Esimerkkikatu 3")).toBe("Asunto Oy Esimerkkikatu");
    expect(name("Kiinteisto Oy Esimerkkikatu 3")).toBe("Kiinteisto Oy Esimerkkikatu");
    expect(name("Koy Esimerkkikatu")).toBe("Koy Esimerkkikatu");
  });

  it("keeps the form of a name that would be left empty", () => {
    expect(name("Oy")).toBe("Oy");
    expect(name("Oy Ab")).toBe("Oy");
  });
});
