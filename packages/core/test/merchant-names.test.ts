/**
 * A shop has one name whatever road the payment took: through a card account's wording, behind a payment service, or
 * on a marketplace. Every name here is made up.
 */
import { describe, expect, it } from "vitest";
import { categorize, compileRules } from "../src/categorize.ts";
import { industryCandidates } from "../src/industry.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import type { Account } from "../src/types.ts";
import { tx } from "./helpers.ts";

const name = (raw: string) => normalizeMerchant(null, raw);

describe("a card account's wording: country and city in front, the city again at the end", () => {
  it.each([
    ["Osto FIN Kuopio Kukkakauppa Ilo Oy Kuopio", "Kukkakauppa Ilo"],
    ["Osto FIN Kuopio Kukkakauppa Ilo Oy", "Kukkakauppa Ilo"],
    // Ä and Ö written AE and OE in the city, and the city at the end in the proper spelling
    ["Osto FIN Jyvaeskylae Kukkakauppa Ilo Oy Jyvaeskylae", "Kukkakauppa Ilo"],
    ["Osto FIN Jyvaeskylae Kukkakauppa Ilo Oy JYVÄSKYLÄ", "Kukkakauppa Ilo"],
    ["Osto FIN Hameenlinna Kahvila Ilo Haemeenlinna", "Kahvila Ilo"],
    // a country other than Finland, and a brand the prefix used to hide
    ["Osto EST Tallinn Kohvik Ilo", "Kohvik Ilo"],
    ["Osto FIN Tampere Prisma Hervanta Tampere", "Prisma"],
    ["Osto FIN Helsinki K-Market Kamppi", "K-Market"],
  ])("%s → %s", (raw, expected) => expect(name(raw)).toBe(expected));

  it("shows the café to the category rules once the processor behind the prefix is gone", () => {
    const raw = "Osto FIN Jyvaeskylae SUMUP *Kahvila Ilo";
    expect(name(raw)).toBe("Kahvila Ilo");
    expect(categorize({ merchant: name(raw), counterparty: null, description: null, mcc: null, amountCents: -1450 }, compileRules([])).category).toBe("restaurants");
    expect(name("Osto FIN Espoo VFI*RAUTAKAUPPA ILO Espoo")).toBe("Rautakauppa Ilo");
  });

  it("needs the leading word and a country code from the ISO list", () => {
    // no such code: the text is read as before
    expect(name("Osto XYZ Kuopio Kukkakauppa Ilo Oy")).toBe("Xyz Kuopio Kukkakauppa Ilo");
    // a shop whose own name starts with three capitals is not cut, with a code of the list or without
    expect(name("XYZ Kauppa Ilo Oy")).toBe("Xyz Kauppa Ilo");
    expect(name("FIN Kuopio Kauppa Ilo Oy")).toBe("Fin Kuopio Kauppa Ilo");
    // "Osto" only as a word of the name
    expect(name("Ostos Kuopio Oy")).toBe("Ostos Kuopio Oy");
  });

  it("never cuts a name to nothing", () => {
    expect(name("Osto FIN Kuopio")).toBe("Fin");
    expect(name("Osto FIN Oy")).toBe("Fin");
  });

  it("drops a word as the city only when the text proves it is one", () => {
    // a town of the list, the same word at the end, or a processor right behind it
    expect(name("Osto FIN Kuopio Kahvila Ilo")).toBe("Kahvila Ilo");
    expect(name("Osto FIN Kemijarvi Kahvila Ilo Kemijarvi")).toBe("Kahvila Ilo");
    expect(name("Osto FIN Kemijarvi SUMUP *Kahvila Ilo")).toBe("Kahvila Ilo");
    expect(name("Osto FIN Kemijarvi PAYTRAIL OYJ KAUPPA ILO OY")).toBe("Kauppa Ilo");
  });

  it("keeps the first word of the name in a row with no city", () => {
    expect(name("Osto FIN Kahvila Ilo Oy")).toBe("Kahvila Ilo Oy");
    expect(name("Osto FIN Rautakauppa Ilo")).toBe("Rautakauppa Ilo");
    expect(name("Osto FIN SUMUP *Kahvila Ilo")).toBe("Kahvila Ilo");
    expect(name("Osto SWE PAYTRAIL OYJ Kauppa Ilo Oy")).toBe("Kauppa Ilo");
    expect(name("Osto FIN Matti Meikalainen")).toBe("Matti Meikalainen");
    // a name that begins with a brand stays that brand's
    expect(name("Osto FIN K-Market Kamppi")).toBe("K-Market");
  });

  it("drops a town missing from the list when a chain with a hyphenated name or a payment service follows it", () => {
    expect(name("Osto FIN Kemijarvi K-market Ilo")).toBe("K-Market");
    expect(name("Osto FIN Kemijarvi S-market Ilo")).toBe("S-Market");
    // a seller of other companies' software in front of the product, as a payment service is
    expect(name("Osto ESP MADRID PADDLE.NET* KAUPPA ILO")).toBe("Kauppa Ilo");
    // a chain's name alone after the country is the name, as before
    expect(name("Osto FIN K-market Ilo")).toBe("K-Market");
  });

  it("keeps the first word of a name before a plain chain word or a seller's star: it can be the name's own", () => {
    expect(name("Osto FIN Pizzeria Power")).toBe("Pizzeria Power");
    expect(name("Osto FIN Grilli Max")).toBe("Grilli Max");
    expect(name("Osto FIN Matti Stark")).toBe("Matti Stark");
    expect(name("Osto FIN Pizzeria Power-Pizza")).toBe("Pizzeria Power-Pizza");
    expect(name("Siirto kortilta FIN Kemijarvi Helen-Maria Virtanen")).toBe("Kemijarvi Helen-Maria Virtanen");
    expect(name("Osto IRL Amazon Prime*AB12C3DE4")).toBe("Amazon Prime");
    expect(name("Osto GBR Audible UK*AB1CD2EF3")).toBe("Audible");
    expect(name("Osto LUX Kindle Svcs*AB1CD2")).toBe("Kindle Svcs");
  });

  it("reads the same shape after a foreign purchase's currency and sum, and after Siirto kortilta", () => {
    expect(name("USD 25,00 Osto IRL DUBLIN 4 EXAMPLE* KAUPPA")).toBe("Example Kauppa");
    expect(name("GBP 1 250,00 Osto GBR LONDON EXAMPLE* KAUPPA")).toBe("Example Kauppa");
    expect(name("Siirto kortilta IRL Dublin Lompakko Ilo**1234*")).toBe("Lompakko Ilo");
    // a sum without a currency code, or a code that is none, is no such text
    expect(name("XYZ 12,00 Osto IRL DUBLIN EXAMPLE* KAUPPA")).not.toBe("Example Kauppa");
  });

  it("cannot tell a town missing from the list from the first word of a name: it stays, and the country goes", () => {
    expect(name("Osto FIN Kemijarvi Kahvila Ilo")).toBe("Kemijarvi Kahvila Ilo");
  });

  it("keeps a person whose surname is the city, and reads another city at the end as a place, as before", () => {
    expect(name("Osto FIN Salo Matti Salo")).toBe("Matti Salo");
    expect(name("Osto FIN Kuopio Kauppa Ilo Oy Espoo")).toBe("Kauppa Ilo");
  });

  it("knows a town whose own name holds OE or AE", () => {
    expect(name("Osto FIN Joensuu Kahvila Ilo")).toBe("Kahvila Ilo");
    expect(name("Osto FIN Kuopio Kahvila Ilo")).toBe("Kahvila Ilo");
    expect(name("Osto FIN Haemeenlinna Kahvila Ilo")).toBe("Kahvila Ilo");
  });

  it("keeps a company named for its town when only the company form follows the town", () => {
    expect(name("Osto FIN Tikkurila Oyj")).toBe("Tikkurila");
    expect(name("Osto FIN Kuopio Oy Kuopio")).toBe("Kuopio");
    expect(name("Osto FIN Tikkurila Oyj Tikkurila")).toBe("Tikkurila");
  });
});

describe("the time, sum and rate a bank writes around the name", () => {
  it.each([
    ["Korttiosto 12.10.2026 klo 14.22 Kukkakauppa Ilo, Kuopio", "Kukkakauppa Ilo"],
    ["KORTTIOSTO 12.10.2026 KLO 9.05 KUKKAKAUPPA ILO", "Kukkakauppa Ilo"],
    ["Kukkakauppa Ilo klo 14:22:05", "Kukkakauppa Ilo"],
    ["USD 25,00 KURSSI 1,0834 EXAMPLESHOP.COM", "Exampleshop.Com"],
    ["EXAMPLESHOP.COM 25,00 USD Kurssi 1,0834", "Exampleshop.Com"],
    ["GBP 1 250,00 VAIHTOKURSSI 0,8611 KAUPPA ILO LTD", "Kauppa Ilo"],
  ])("%s → %s", (raw, expected) => expect(name(raw)).toBe(expected));

  it("leaves the rate out of the category: a purchase abroad is no course", () => {
    const rules = compileRules([]);
    const of = (description: string) => categorize({ merchant: name(description), counterparty: null, description, mcc: null, amountCents: -6426 }, rules).category;
    expect(of("GBP 55,26 KURSSI 0,8611 KAHVILA ILO LONDON")).toBe(of("KAHVILA ILO LONDON"));
    expect(of("GBP 55,26 KURSSI 0,8611 KAHVILA ILO LONDON")).not.toBe("education");
    // a course is still one, with its number too
    expect(of("KURSSI 2026 KEVAT")).toBe("education");
    expect(of("KURSSIMAKSU")).toBe("education");
  });

  it("keeps a name that holds digits and three capitals", () => {
    // no currency code: the words are the shop's
    expect(name("Kauppa Ilo 12,00 ABC")).toBe("Kauppa Ilo Abc");
    // "KLO" with no time after it is a word of the name
    expect(name("Ravintola Klo Kuopio")).toBe("Ravintola Klo");
  });

  it("keeps a course with its date or credits: a rate has three decimals or more", () => {
    const rules = compileRules([]);
    const of = (description: string) => categorize({ merchant: name(description), counterparty: null, description, mcc: null, amountCents: -12000 }, rules).category;
    expect(name("KURSSI 1.10.2026")).toBe("Kurssi");
    expect(name("Kurssi 12.10")).toBe("Kurssi");
    expect(name("Kurssi 12.10. Kansalaisopisto")).toBe("Kurssi Kansalaisopisto");
    expect(name("Kesäkurssi 1.10. Opisto")).toBe("Kesäkurssi Opisto");
    // Ä and K are no edge of a word: the end of KESÄKURSSI and KESÄKLO is no rate or time
    expect(name("KESÄKURSSI 1,0834 OPISTO")).toBe("Kesäkurssi Opisto");
    expect(name("Kesäklo 12.30 Kahvila")).toBe("Kesäklo Kahvila");
    for (const description of ["KURSSI 1.10.2026", "Kurssi 12.10", "KURSSI 1,5 OP"]) expect(of(description)).toBe("education");
  });

  it("lets a user's rule read the description as the bank wrote it", () => {
    const rule = (pattern: string) => compileRules([{ field: "description", pattern, category: "housing", priority: 10 }]);
    const of = (pattern: string, description: string) => categorize({ merchant: "Kauppa Ilo", counterparty: null, description, mcc: null, amountCents: -45000 }, rule(pattern));
    expect(of("KURSSI 1,0834", "USD 25,00 KURSSI 1,0834 KAUPPA ILO")).toMatchObject({ category: "housing", byUser: true });
    expect(of("KLO 14.22", "Korttiosto 12.10.2026 klo 14.22 Kauppa Ilo")).toMatchObject({ category: "housing", byUser: true });
    expect(of("450,00 EUR", "VUOKRA 450,00 EUR KAUPPA ILO")).toMatchObject({ category: "housing", byUser: true });
  });
});

describe("a payment service in front of the name", () => {
  it.each([
    ["PTL*RAUTAKAUPPA ILO", "Rautakauppa Ilo"],
    ["ZETTLE-*TORIMYYJA", "Torimyyja"],
    ["ZETTLE_*PIKKUPUOTI", "Pikkupuoti"],
    ["SUMUP *KAHVILA ILO", "Kahvila Ilo"],
    ["PAYPAL *PIKKUPUOTI", "Pikkupuoti"],
    ["PAYTRAIL OYJ KAUPPA ILO OY", "Kauppa Ilo"],
  ])("%s → %s", (raw, expected) => expect(name(raw)).toBe(expected));

  it("takes the company name only as the leading words, with a company form and a name after it", () => {
    expect(name("PAYTRAIL OYJ")).toBe("Paytrail");
    expect(name("PAYTRAIL OYJ 123456789")).toBe("Paytrail");
    expect(name("KAUPPA OY PAYTRAIL OYJ")).toBe("Kauppa Oy Paytrail");
    // a short code is no company: "PP" is not Paytrail
    expect(name("PP OY KAHVILA ILO")).toBe("Pp Oy Kahvila Ilo");
    // a name that only starts like a processor
    expect(name("NETSON OY")).toBe("Netson");
  });

  it("keeps the service's own name when only a town follows its company form", () => {
    expect(name("PAYTRAIL OYJ HELSINKI")).toBe("Paytrail");
    expect(name("KLARNA AB STOCKHOLM")).toBe("Klarna");
    expect(name("PAYTRAIL OYJ HÄMEENLINNA")).toBe("Paytrail");
    expect(name("PAYTRAIL OYJ ISO OMENA")).toBe("Paytrail");
    // a shop behind the form is still the name, also when a town ends the text
    expect(name("PAYTRAIL OYJ KAUPPA ILO OY HELSINKI")).toBe("Kauppa Ilo");
    // the star form names a shop, and a shop may be named for a town
    expect(name("PTL*HELSINKI")).toBe("Helsinki");
  });

  it("keeps the service's name only when a place and at most a country are all that is left behind it", () => {
    expect(name("PAYTRAIL OYJ HELSINKI FI")).toBe("Paytrail");
    expect(name("KLARNA AB STOCKHOLM SE")).toBe("Klarna");
    // a shop whose own name begins with a town is the name, as it was before the service's name was kept
    expect(name("PAYTRAIL OYJ TURKU ENERGIA OY")).toBe("Turku Energia Oy");
    expect(name("PAYTRAIL OYJ LAHTI ENERGIA OY")).toBe("Lahti Energia Oy");
    expect(name("PAYTRAIL OYJ KUOPIO GOLF OY")).toBe("Kuopio Golf Oy");
    expect(name("KLARNA AB HELSINKI DISTILLING COMPANY OY")).toBe("Helsinki Distilling Company Oy");
  });

  it("leaves a pay-by-bank service that names no merchant as it is", () => {
    expect(name("TRUSTLY GROUP AB")).toBe("Trustly");
    expect(name("ZIMPLER AB")).toBe("Zimpler");
  });
});

describe("a marketplace keeps its own name", () => {
  it.each([
    ["TORI", "Tori"],
    ["TORI.FI", "Tori"],
    ["TORI.FI KAYTETTY POLKUPYORA 26", "Tori"],
    ["ENEBA ORDER O-12345678", "Eneba"],
    ["PAYPAL *ENEBA", "Eneba"],
  ])("%s → %s", (raw, expected) => expect(name(raw)).toBe(expected));

  it("is no other shop that starts with the same letters", () => {
    expect(name("TORI KEBAB")).toBe("Tori Kebab");
    expect(name("TORI KAHVILA OY")).toBe("Tori Kahvila Oy");
    expect(name("Osto FIN Kuopio Tori Kebab Kuopio")).toBe("Tori Kebab");
    expect(name("TORIMYYJA")).toBe("Torimyyja");
    expect(name("TORI-KAHVILA")).toBe("Tori-Kahvila");
    expect(name("TORIN KIOSKI")).toBe("Torin Kioski");
    expect(name("ENEBAS OY")).toBe("Enebas");
  });
});

describe("the trade register", () => {
  const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
  const candidates = (text: string) =>
    industryCandidates([tx({ accountId: "card", bookingDate: "2026-09-01", amountCents: -2500, description: text, merchant: name(text) })], [card]);

  it("is asked about the cleaned name of a shop and never about a person's", () => {
    expect(candidates("Osto FIN Kuopio Kukkakauppa Ilo Oy Kuopio")).toEqual(["Kukkakauppa Ilo"]);
    expect(candidates("Osto FIN Kuopio Matti Meikalainen")).toEqual([]);
    expect(candidates("Osto FIN Kuopio Matti Meikalainen Kuopio")).toEqual([]);
    expect(candidates("Osto FIN Salo Matti Salo")).toEqual([]);
  });
});
