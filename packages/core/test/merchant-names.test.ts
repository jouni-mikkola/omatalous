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
