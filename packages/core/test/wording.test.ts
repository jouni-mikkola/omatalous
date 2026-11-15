import { describe, expect, it } from "vitest";
import { isMobilePay } from "../src/industry.ts";
import { fold } from "../src/merchant.ts";
import { companyForms, type FormUse, hasPayeeForm, housingCharge, isCardIssuerText, isLenderName, isLoanText } from "../src/wording.ts";

const forms = (use: FormUse) => [...companyForms(use)].sort();
const words = (list: string) => list.split(" ").sort();
const hasForm = (name: string) => hasPayeeForm(fold(name));

describe("shared wording", () => {
  // These were hand-written lists. Each use is pinned to the list it had, so keeping them in one file changed
  // nothing; a change to a list shows up here and has to be a decision. The third list, the forms that made a
  // MobilePay payee a company, went when the category rules took the register's shape of a name (isPersonShaped).
  it("company forms: each use keeps its own list", () => {
    expect(forms("strip")).toEqual(words("OY OYJ AB ABP KY AY RY RF TMI OSK KOY AS LTD SR AOY"));
    expect(forms("payee")).toEqual(words("OY OYJ AB ABP KY AY RY TMI OSK KOY LTD LIMITED INC GMBH LLC PLC BV"));
  });

  it("a payee is a business by a company form at either end, but not by SA, SE or AS", () => {
    expect(hasForm("Tikkurilan Tiikerit ry")).toBe(true);
    expect(hasForm("Oy Kahvila Ilo Ab")).toBe(true);
    expect(hasForm("Maria SA")).toBe(false);
    expect(hasForm("Anna Se")).toBe(false);
  });

  it("a character nobody sees splits no word into a company form", () => {
    // a soft hyphen from a copied page, a zero-width space, a direction mark, a combining accent
    for (const name of ["MEIKÄLÄINEN HEN\u00ADRY", "MATTI LER\u200BOY", "KY\u200DLLIKKI MEIKÄLÄINEN", "MATTI SAA\u200EB", "ABE\u0301L MEIKÄLÄINEN"]) expect(hasForm(name), JSON.stringify(name)).toBe(false);
    for (const name of ["ESIMERKKI\u200B OY", "\uFEFFOY ESIMERKKI", "ESIMERKKI O\u00ADY"]) expect(hasForm(name), JSON.stringify(name)).toBe(true);
  });

  it("an issuer that also lends stands in each list it belongs to", () => {
    for (const read of [isCardIssuerText, isLenderName]) expect(read("RESURS BANK AB")).toBe(true);
    expect(isLenderName("BANK NORWEGIAN")).toBe(false);
    // a contract is a loan's only at an issuer, where this is asked; the category rules do not read the word
    for (const text of ["OSAMAKSU 3/12", "LAINAN LYHENNYS", "RAHOITUSSOPIMUS 123", "SOPIMUS 123", "KULUTUSLUOTTO"]) expect(isLoanText(text), text).toBe(true);
    expect(isLoanText("LASKU 09/2026")).toBe(false);
  });

  it("MobilePay wording marks a payment", () => {
    expect(isMobilePay({ counterparty: "Matti Meikäläinen", description: "MobilePay" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "PIVO-maksu" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "Siirto henkilölle" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "Siirto henkilöltä" })).toBe(true);
    expect(isMobilePay({ counterparty: null, description: "PIVOT" })).toBe(false);
  });
});

describe("the name of a charge of the home", () => {
  const name = (payee: string, text: string, utility = false) => housingCharge(fold(payee), fold(text), utility)?.label ?? null;
  const company = "As Oy Esimerkkikatu";

  it("is read from the words of the payment, and from the payee where they name nothing", () => {
    const cases: [payee: string, text: string, name: string | null][] = [
      [company, "Hoitovastike 10/2026", "Hoitovastike"],
      [company, "Rahoitusvastike", "Rahoitusvastike"],
      [company, "Lainaosuus", "Rahoitusvastike"],
      [company, "Pääomavastike", "Pääomavastike"],
      ["Esimerkin Asumisoikeus Oy", "Käyttövastike", "Käyttövastike"],
      [company, "Vesimaksu", "Vesimaksu"],
      [company, "Vesi 2 hlö", "Vesimaksu"],
      [company, "Autopaikka 12", "Autopaikka"],
      ["Esimerkin Asunnot Oy", "Vuokra 10/2026", "Vuokra"],
      [company, "Lasku", "Vastike"],
      ["Esimerkki Oy", "Yhtiövastike", "Vastike"],
      // near misses: a word that only starts like one of the list, and a payee that names nothing
      ["Esimerkki Oy", "Vesikaton korjaus", null],
      ["Esimerkki Oy", "Lasku", null],
    ];
    for (const [payee, text, expected] of cases) expect(name(payee, text), `${payee}: ${text}`).toBe(expected);
  });

  it("gives way to a bill of rent or vastike: the water or the car place named beside it is part of that bill", () => {
    const cases: [payee: string, text: string, name: string | null][] = [
      ["Matti Meikäläinen", "Vuokra ja vesimaksu 10/2026", "Vuokra"],
      ["Sato Oyj", "Vuokra + vesi", "Vuokra"],
      ["Esimerkin Asunnot Oy", "Vuokra ja autopaikka", "Vuokra"],
      ["Esimerkin Asunnot Oy", "Autopaikka & vuokra", "Vuokra"],
      [company, "Yhtiövastike ja vesimaksu", "Vastike"],
      [company, "Vastike ja vesi", "Vastike"],
      [company, "Vastike ja autopaikka", "Vastike"],
      // near misses: the same words alone, a landlord that bills water alone, a car place rented, and a name that only ends like the word "ja"
      ["Matti Meikäläinen", "Vesimaksu", "Vesimaksu"],
      ["Sato Oyj", "Vesimaksu", "Vesimaksu"],
      [company, "Autopaikka", "Autopaikka"],
      ["Esimerkin Asunnot Oy", "Autopaikan vuokra", "Autopaikka"],
      ["Esimerkin Asunnot Oy", "Vuokra Maja autopaikka", "Autopaikka"],
      ["Esimerkin Asunnot Oy", "Vuokra autopaikka", "Autopaikka"],
    ];
    for (const [payee, text, expected] of cases) expect(name(payee, text), `${payee}: ${text}`).toBe(expected);
  });

  it("takes the first name of the list that holds", () => {
    expect(name(company, "Hoitovastike ja rahoitusvastike")).toBe("Rahoitusvastike");
    // a parking place is rented, and it is no rent of a home
    expect(name("Esimerkin Asunnot Oy", "Autopaikan vuokra")).toBe("Autopaikka");
    expect(housingCharge(fold("Esimerkin Asunnot Oy"), fold("Vuokra"), false)).toEqual({ kind: "rent", label: "Vuokra" });
  });

  it("names electricity by the payee as the electricity area does, only in its own category and never over heat or water", () => {
    expect(name("Helen Oy", "Lasku", true)).toBe("Sähkö");
    expect(name("Helen Sähköverkko Oy", "Lasku", true)).toBe("Sähkönsiirto");
    expect(name("Helen Oy", "Kaukolämpö", true)).toBe("Kaukolämpö");
    expect(name("HSY", "Vesilasku", true)).toBe("Vesi");
    // a landlord whose name holds a seller's is no electricity bill
    expect(name("Helena Meikäläinen", "Lasku")).toBeNull();
  });
});
