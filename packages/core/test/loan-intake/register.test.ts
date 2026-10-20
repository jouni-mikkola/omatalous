import { describe, expect, it } from "vitest";
import { parseLoanText } from "../../src/index.ts";
import { read, text, warned } from "./helpers.ts";

// Made-up loans in the shape of the positive credit register's listing: a lender's name on a line of its own, then
// rows of a label and a value. Only the label words are the register's.
const LISTING = text(
  "Luottotietoni",
  "Esimerkkipankki Oyj",
  "Luoton tyyppi: Kertaluotto",
  "Myönnetty määrä: 150 000,00 €",
  "Luoton saldo: 120 000,00 € (30.9.2026)",
  "Kokonaiskorko: 3,39 %",
  "Viitekorko: 12 kk Euribor 2,74 %",
  "Marginaali: 0,65 %",
  "Lyhennystapa: Annuiteetti",
  "Lyhennysväli: 1 kk",
  "Viimeinen eräpäivä: 31.10.2046",
  "",
  "Mallirahoitus Bank AB",
  "Luoton tyyppi: Jatkuva luotto",
  "Luottoraja\t2 000,00 €",
  "Luoton saldo\t1 250,50 €",
  "Kokonaiskorko\t14,9 %",
);

describe("loan intake: the credit register's listing", () => {
  it("reads one draft per lender, every labelled field sure and the lender's name to check", () => {
    const drafts = parseLoanText(LISTING);
    expect(drafts.map(read)).toEqual([
      {
        lender: "Esimerkkipankki Oyj check",
        grantedCents: "15000000 sure",
        balanceCents: "12000000 sure",
        // a date beside the balance has no label of its own
        balanceDate: "2026-09-30 check",
        rateBp: "339 sure",
        reference: "euribor_12 sure",
        marginBp: "65 sure",
        repayment: "annuity sure",
        intervalMonths: "1 sure",
        endDate: "2046-10-31 sure",
      },
      { lender: "Mallirahoitus Bank AB check", limitCents: "200000 sure", balanceCents: "125050 sure", rateBp: "1490 sure" },
    ]);
    expect(drafts.map(warned)).toEqual([[], []]);
    expect(drafts[0]!.balanceCents!.line).toBe("Luoton saldo: 120 000,00 € (30.9.2026)");
    expect(drafts[1]!.limitCents!.line).toBe("Luottoraja 2 000,00 €");
  });

  it("takes a colon, a tab or spaces between the label and the value", () => {
    for (const between of [": ", ":", "\t", ":\t", "  ", " ", " : "]) {
      expect(parseLoanText(`Luoton saldo${between}1 250,50 €`).map(read), JSON.stringify(between)).toEqual([{ balanceCents: "125050 sure" }]);
    }
  });

  it("reads euro amounts in the thousands with and without separators", () => {
    const forms = ["150 000,00 €", "150.000,00 €", "150000,00 €", "150000 €", "150 000 €", "150 000,00", "150 000,00 EUR", "150 000 euroa", "150 000,00 €", "150 000,00 €", "150 000 €"];
    for (const form of forms) expect(parseLoanText(`Myönnetty määrä: ${form}`).map(read), form).toEqual([{ grantedCents: "15000000 sure" }]);
    expect(parseLoanText("Luottoraja 500 €").map(read)).toEqual([{ limitCents: "50000 sure" }]);
    expect(parseLoanText("Luoton saldo 1 234 567,89 €").map(read)).toEqual([{ balanceCents: "123456789 sure" }]);
    expect(parseLoanText("Luoton saldo 0,00 €").map(read)).toEqual([{ balanceCents: "0 sure" }]);
  });

  it("leaves out a field whose label has no value", () => {
    const drafts = parseLoanText(text("Myönnetty määrä: 10 000,00 €", "Marginaali:", "Lyhennystapa: Annuiteetti", "Luottoraja -", "Viitekorko: Esimerkkipankki Prime", "Viimeinen eräpäivä"));
    expect(drafts.map(read)).toEqual([{ grantedCents: "1000000 sure", repayment: "annuity sure" }]);
  });

  it("never reads a figure that has no label", () => {
    expect(parseLoanText(text("150 000,00 €", "3,25 %", "31.12.2031", "Annuiteetti"))).toEqual([]);
    // the second amount on a row has no label of its own, so neither is the granted amount for sure
    expect(parseLoanText("Myönnetty määrä 150 000,00 € 120 000,00 €")).toEqual([]);
  });

  it("a sum over every loan of the listing is no loan's figure", () => {
    expect(parseLoanText(text("Luoton saldo yhteensä 250 000,00 €", "Luottoraja yhteensä: 5 000,00 €"))).toEqual([]);
  });

  it("a granted amount and a different credit limit in one loan are most likely two loans", () => {
    // no label repeats and no lender's name stands between, so the text gives one draft: both figures to check
    const [draft] = parseLoanText(text("Myönnetty määrä 10 000,00 €", "Kokonaiskorko 6,5 %", "Luottoraja 3 000,00 €"));
    expect(read(draft!)).toEqual({ grantedCents: "1000000 check", rateBp: "650 sure", limitCents: "300000 check" });
    expect(draft!.warnings).toEqual([{ id: "mixed_loans", text: "Osa tiedoista voi kuulua toiselle lainalle. Tarkista ne.", fields: ["grantedCents", "limitCents"] }]);
  });

  it("a lender's line is a name: a company by its form, not a sentence, a housing company or an insurer", () => {
    const under = (line: string) => parseLoanText(text("Luoton saldo 7 500,00 €", line, "Luottoraja 9 000,00 €")).map(read);
    const split = (lender: string) => [{ balanceCents: "750000 sure" }, { lender: `${lender} check`, limitCents: "900000 sure" }];
    for (const lender of ["Malliluotto Oy", "Esimerkkipankki Oyj", "Mallirahoitus Bank AB (publ)", "Esimerkki Bank A/S, Suomen sivuliike"]) expect(under(lender), lender).toEqual(split(lender));
    const one = [{ balanceCents: "750000 sure", limitCents: "900000 sure" }];
    for (const other of ["Maksut veloitetaan tililtä Esimerkkipankki", "Vakuus: Asunto Oy Mallila", "Asunto Oy Mallila", "Malli Vahinkovakuutus Oyj", "Verkkopankki", "Esimerkkipankki Oyj, puh. 010 123 4567"]) {
      expect(under(other), other).toEqual(one);
    }
  });

  it("a balance above the granted amount lowers both and changes neither", () => {
    const [draft] = parseLoanText(text("Myönnetty määrä 10 000,00 €", "Luoton saldo 12 000,00 €", "Kokonaiskorko 5,5 %"));
    expect(read(draft!)).toEqual({ grantedCents: "1000000 check", balanceCents: "1200000 check", rateBp: "550 sure" });
    expect(draft!.warnings).toEqual([{ id: "balance_over_granted", text: "Lainaa on jäljellä enemmän kuin sitä myönnettiin. Tarkista summat.", fields: ["balanceCents", "grantedCents"] }]);
    // equal is no warning: a loan drawn and not yet paid
    expect(parseLoanText(text("Myönnetty määrä 10 000,00 €", "Luoton saldo 10 000,00 €")).map(warned)).toEqual([[]]);
  });

  it("a balance above the credit limit warns the same way", () => {
    const [draft] = parseLoanText(text("Luottoraja 2 000,00 €", "Luoton saldo 2 300,00 €"));
    expect(read(draft!)).toEqual({ limitCents: "200000 check", balanceCents: "230000 check" });
    expect(warned(draft!)).toEqual(["balance_over_limit"]);
  });

  it("the same label again starts the next loan", () => {
    const drafts = parseLoanText(text("Myönnetty määrä 10 000,00 €", "Luoton saldo 7 500,00 €", "Myönnetty määrä 10 000,00 €", "Luoton saldo 2 000,00 €"));
    expect(drafts.map(read)).toEqual([
      { grantedCents: "1000000 sure", balanceCents: "750000 sure" },
      { grantedCents: "1000000 sure", balanceCents: "200000 sure" },
    ]);
  });

  it("a lender's name above several loans is the lender of each, and a new name starts a loan", () => {
    const drafts = parseLoanText(
      text("Esimerkkipankki Oyj", "Luoton saldo 7 500,00 €", "Kokonaiskorko 4,1 %", "Luoton saldo 2 000,00 €", "Kokonaiskorko 4,6 %", "Mallirahoitus Bank AB", "Luottoraja 3 000,00 €", "Luoton saldo 100,00 €"),
    );
    expect(drafts.map(read)).toEqual([
      { lender: "Esimerkkipankki Oyj check", balanceCents: "750000 sure", rateBp: "410 sure" },
      { lender: "Esimerkkipankki Oyj check", balanceCents: "200000 sure", rateBp: "460 sure" },
      { lender: "Mallirahoitus Bank AB check", limitCents: "300000 sure", balanceCents: "10000 sure" },
    ]);
    expect(drafts.map(warned)).toEqual([[], [], []]);
    // a name with nothing under it is no loan
    expect(parseLoanText(text("Luoton saldo 7 500,00 €", "Esimerkkipankki Oyj")).map(read)).toEqual([{ balanceCents: "750000 sure" }]);
  });

  it("a labelled lender is sure and starts a loan", () => {
    const drafts = parseLoanText(text("Luotonantaja: Esimerkkipankki Oyj", "Luoton saldo 7 500,00 €", "Luotonantaja: Mallirahoitus Bank AB", "Luoton saldo 100,00 €"));
    expect(drafts.map(read)).toEqual([
      { lender: "Esimerkkipankki Oyj sure", balanceCents: "750000 sure" },
      { lender: "Mallirahoitus Bank AB sure", balanceCents: "10000 sure" },
    ]);
    // after the figures the lender's place is not known: it may name the loan above
    const late = parseLoanText(text("Luoton saldo 7 500,00 €", "Luotonantaja: Esimerkkipankki Oyj", "Luoton saldo 100,00 €"));
    expect(late.map(read)).toEqual([{ balanceCents: "750000 sure" }, { lender: "Esimerkkipankki Oyj check", balanceCents: "10000 sure" }]);
    // a name that holds a label's word is not cut at it
    expect(parseLoanText(text("Luotonantaja: Laina ja Korko Oy", "Luoton saldo 100,00 €")).map(read)).toEqual([{ balanceCents: "10000 sure" }]);
  });

  it("two loans with different labels and no line between them: what may be the other loan's is lowered", () => {
    const drafts = parseLoanText(
      text("Myönnetty määrä 10 000,00 €", "Luoton saldo 2 500,00 €", "Kokonaiskorko 6,5 %", "Viimeinen eräpäivä 1.6.2029", "Luottoraja 3 000,00 €", "Luoton saldo 1 200,00 €", "Kokonaiskorko 15,9 %"),
    );
    // Luottoraja belongs to the second loan, and nothing in the text says so before Luoton saldo repeats
    expect(drafts.map(read)).toEqual([
      { grantedCents: "1000000 check", balanceCents: "250000 sure", rateBp: "650 sure", endDate: "2029-06-01 check", limitCents: "300000 check" },
      { balanceCents: "120000 sure", rateBp: "1590 sure" },
    ]);
    expect(drafts[0]!.warnings.map((w) => [w.id, w.fields])).toEqual([["mixed_loans", ["endDate", "limitCents", "grantedCents"]]]);
  });

  it("a type or number label that opens each block splits the loans exactly", () => {
    const drafts = parseLoanText(
      text("Luoton tyyppi: Kertaluotto", "Myönnetty määrä 10 000,00 €", "Luoton saldo 7 500,00 €", "Luoton tyyppi: Jatkuva luotto", "Luottoraja 3 000,00 €", "Luoton saldo 1 200,00 €"),
    );
    expect(drafts.map(read)).toEqual([
      { grantedCents: "1000000 sure", balanceCents: "750000 sure" },
      { limitCents: "300000 sure", balanceCents: "120000 sure" },
    ]);
    expect(drafts.map(warned)).toEqual([[], []]);
  });

  it("two labels on one row are read when a value or a tab stands between them", () => {
    const rows = text("Luoton saldo 120 000,00 € Myönnetty määrä 150 000,00 €", "Kokonaiskorko\t3,39 %\tMarginaali\t0,65 %");
    expect(parseLoanText(rows).map(read)).toEqual([{ balanceCents: "12000000 sure", grantedCents: "15000000 sure", rateBp: "339 sure", marginBp: "65 sure" }]);
    // a label inside a value's text is part of a sentence: the rate before it is whole, what follows is not read
    expect(parseLoanText("Kokonaiskorko 3,39 % (viitekorko 2,74 % + marginaali 0,65 %)").map(read)).toEqual([{ rateBp: "339 sure" }]);
    // a row of labels with the values on the next row is not paired
    expect(parseLoanText(text("Myönnetty määrä\tLuoton saldo", "150 000,00 €\t120 000,00 €"))).toEqual([]);
  });

  it("reads the reference rate's name, and leaves out one the app has no id for", () => {
    const cases: [string, string | undefined][] = [
      ["12 kk Euribor", "euribor_12 sure"],
      ["Euribor 6 kk", "euribor_6 sure"],
      ["3 kuukauden euribor", "euribor_3 sure"],
      ["Euribor 12", "euribor_12 sure"],
      ["Euribor 12 kk 2,737 %", "euribor_12 sure"],
      ["Kiinteä korko", "fixed sure"],
      ["Euribor 12 kk (act/360)", "euribor_12 check"],
      ["12 kk Euribor + 0,65 %", "euribor_12 check"],
      ["Esimerkkipankki Prime", undefined],
      ["Euribor", undefined],
      ["1 kk Euribor", undefined],
      ["Euribor 3 kk tai 6 kk", undefined],
    ];
    for (const [value, expected] of cases) {
      const [draft] = parseLoanText(text("Luoton saldo 100,00 €", `Viitekorko: ${value}`));
      expect(read(draft!).reference, value).toBe(expected);
    }
  });

  it("reads how and how often the loan is paid back", () => {
    const repayments: [string, string | undefined][] = [
      ["Annuiteetti", "annuity sure"],
      ["Tasaerä", "annuity sure"],
      ["Tasaerä (annuiteetti)", "annuity sure"],
      ["Kiinteä tasaerä", "fixed_instalment sure"],
      ["Tasalyhennys", "equal_principal sure"],
      ["Kertalyhenteinen", "bullet sure"],
      ["Annuiteetti, lyhennysvapaa 6 kk", "annuity check"],
      ["Annuiteetti tai tasalyhennys", undefined],
      ["Muu", undefined],
    ];
    for (const [value, expected] of repayments) expect(read(parseLoanText(text("Luoton saldo 100,00 €", `Lyhennystapa: ${value}`))[0]!).repayment, value).toBe(expected);
    const intervals: [string, string | undefined][] = [
      ["1 kk", "1 sure"],
      ["Kuukausi", "1 sure"],
      ["kuukausittain", "1 sure"],
      ["3 kuukauden välein", "3 sure"],
      ["Neljännesvuosittain", "3 sure"],
      ["puolivuosittain", "6 sure"],
      ["Vuosi", "12 sure"],
      ["12 kk", "12 sure"],
      ["2 viikkoa", undefined],
      ["1 kk tai 3 kk", undefined],
    ];
    for (const [value, expected] of intervals) expect(read(parseLoanText(text("Luoton saldo 100,00 €", `Lyhennysväli: ${value}`))[0]!).intervalMonths, value).toBe(expected);
  });

  it("OCR noise in a row gives check, never sure", () => {
    const [draft] = parseLoanText(text("Luoton sa1do: l2O OOO,OO €", "Myönnetty maara: 150 000 00 €", "Kokonaiskorko: 3.39 %"));
    expect(read(draft!)).toEqual({ balanceCents: "12000000 check", grantedCents: "15000000 check", rateBp: "339 check" });
  });

  it("text with no loan gives an empty list", () => {
    expect(parseLoanText("")).toEqual([]);
    expect(parseLoanText(text("Luottotietoni", "Rekisterissä ei ole luottoja.", "Tiedot haettu 12.10.2026", "Esimerkkipankki Oyj"))).toEqual([]);
    expect(parseLoanText(text("Tilin saldo 1 234,56 €", "Käytettävissä 1 000,00 €", "Talletuskorko 2,00 %"))).toEqual([]);
  });
});
