import { describe, expect, it } from "vitest";
import { parseLoanText } from "../../src/index.ts";
import { read, text, warned } from "./helpers.ts";

// A made-up offer on the SECCI form (Vakiomuotoiset eurooppalaiset kuluttajaluottotiedot), as its text comes out of
// a PDF: a label, sometimes the form's own description of it, then the value.
const FORM = text(
  "Vakiomuotoiset eurooppalaiset kuluttajaluottotiedot",
  "1. Luotonantajan/luotonvälittäjän henkilöllisyys ja yhteystiedot",
  "Luotonantaja Esimerkkiluotto Oy",
  "Osoite Mallikatu 1, 00100 Helsinki",
  "2. Kuvaus luoton pääominaisuuksista",
  "Luottotyyppi Kertaluotto",
  "Luoton kokonaismäärä",
  "Tällä tarkoitetaan luoton enimmäismäärää tai luottosopimuksen mukaisesti käyttöön annettavaa kokonaissummaa.",
  "8 000,00 euroa",
  "Luottosopimuksen voimassaoloaika 60 kuukautta",
  "Maksuerät",
  "Kuukausierä 162,10 €",
  "Maksettava kokonaismäärä 9 726,00 €",
  "3. Luoton kustannukset",
  "Lainakorko tai tarvittaessa luottosopimukseen sovellettavat erisuuruiset lainakorot 7,90 % kiinteä",
  "Todellinen vuosikorko 9,12 %",
  "Viivästyskorko 11,50 %",
);

describe("loan intake: a SECCI form", () => {
  it("reads the lender, the amount, the rate and the payment, and no other figure of the form", () => {
    const drafts = parseLoanText(FORM);
    expect(drafts.map(read)).toEqual([
      {
        lender: "Esimerkkiluotto Oy sure",
        // the form's description stands between the label and the value
        grantedCents: "800000 check",
        paymentCents: "16210 sure",
        // words around the value: the label's own tail and "kiinteä"
        rateBp: "790 check",
      },
    ]);
    expect(drafts.map(warned)).toEqual([[]]);
    expect(drafts[0]!.grantedCents!.line).toBe("Luoton kokonaismäärä 8 000,00 euroa");
  });

  it("a value beside its label is sure", () => {
    const [draft] = parseLoanText(text("Luoton kokonaismäärä 8 000,00 euroa", "Lainakorko 7,90 %", "Kuukausierä: 162,10 euroa"));
    expect(read(draft!)).toEqual({ grantedCents: "800000 sure", rateBp: "790 sure", paymentCents: "16210 sure" });
  });

  it("the annual percentage rate, late interest and the total to pay are not the loan's rate or amount", () => {
    expect(parseLoanText(text("Todellinen vuosikorko 9,12 %", "Viivästyskorko 11,50 %", "Maksettava kokonaismäärä 9 726,00 €", "Luoton kokonaiskustannukset 1 726,00 €"))).toEqual([]);
  });

  it("leaves out a rate written as its parts, two rates, and a label with no value", () => {
    const cases = [
      "Lainakorko: 3 kk Euribor + 4,50 %",
      "Lainakorko 7,90 % ensimmäiset 12 kk, sen jälkeen 9,90 %",
      "Lainakorko 7,90 % tai 9,90 %",
      "Lainakorko 1.1.2027 alkaen 7,90 %",
      "Lainakorko",
      "Lainakorko: katso hinnasto",
    ];
    for (const line of cases) expect(parseLoanText(text("Luoton kokonaismäärä 8 000,00 €", line)).map(read), line).toEqual([{ grantedCents: "800000 sure" }]);
    // a line of description is skipped, a line with another figure is not
    const [draft] = parseLoanText(text("Luoton kokonaismäärä 8 000,00 €", "Kuukausierä", "Erät maksetaan kuukausittain 60 kuukauden ajan.", "162,10 €"));
    expect(read(draft!)).toEqual({ grantedCents: "800000 sure" });
  });

  it("reads euro amounts in the thousands with and without separators", () => {
    for (const form of ["8 000 euroa", "8000 €", "8.000,00 EUR", "8 000,00 e", "8000,00", "EUR 8 000,00"]) {
      expect(parseLoanText(`Luoton kokonaismäärä ${form}`).map(read), form).toEqual([{ grantedCents: "800000 sure" }]);
    }
    // a count of months or years beside the amount: the amount is not known to be the only figure meant
    expect(parseLoanText("Luoton kokonaismäärä 8 000 € 5 vuotta")).toEqual([]);
  });

  it("two forms in one paste give two drafts", () => {
    const second = FORM.replace("Esimerkkiluotto Oy", "Mallirahoitus Bank AB").replace("8 000,00 euroa", "3 500,00 euroa").replace("162,10", "71,05");
    const drafts = parseLoanText(`${FORM}\n\n${second}`);
    expect(drafts.map((d) => [d.lender?.value, d.grantedCents?.value, d.paymentCents?.value])).toEqual([
      ["Esimerkkiluotto Oy", 800000, 16210],
      ["Mallirahoitus Bank AB", 350000, 7105],
    ]);
  });

  it("a balance above the amount of the offer lowers both", () => {
    const [draft] = parseLoanText(text("Luoton kokonaismäärä 8 000,00 €", "Luoton saldo 9 000,00 €"));
    expect(read(draft!)).toEqual({ grantedCents: "800000 check", balanceCents: "900000 check" });
    expect(warned(draft!)).toEqual(["balance_over_granted"]);
  });

  it("OCR noise gives check, never sure", () => {
    const [draft] = parseLoanText(text("Luoton kokonaismaara 8 OOO euroa", "Lainakorko 7 90 %", "Kuukausiera l62,lO €"));
    expect(read(draft!)).toEqual({ grantedCents: "800000 check", rateBp: "790 check", paymentCents: "16210 check" });
  });

  it("a form with no figures filled in gives an empty list", () => {
    expect(parseLoanText(text("Vakiomuotoiset eurooppalaiset kuluttajaluottotiedot", "Luotonantaja", "Luottotyyppi", "Luoton kokonaismäärä", "Lainakorko", "Kuukausierä"))).toEqual([]);
  });
});
