import { describe, expect, it } from "vitest";
import { parseLoanText } from "../../src/index.ts";
import { read, text, warned } from "./helpers.ts";

// A made-up loan as a bank's own loan page gives it when the page is selected and copied: each label on a line, its
// value on the next.
const PAGE = text(
  "Verkkopankki",
  "Lainat",
  "Asuntolaina",
  "Lainan numero",
  "12-345678",
  "Lainan määrä",
  "200 000,00 €",
  "Jäljellä oleva lainamäärä",
  "154 321,09 €",
  "Korko",
  "4,112 %",
  "Viitekorko",
  "Euribor 12 kk",
  "Marginaali",
  "0,55 %",
  "Lyhennystapa",
  "Tasaerä",
  "Seuraava eräpäivä",
  "5.11.2026",
  "Seuraavan erän määrä",
  "1 204,37 €",
  "Viimeinen eräpäivä",
  "5.3.2044",
  "Ota yhteyttä",
);

describe("loan intake: a bank's loan page", () => {
  it("reads a value from the line below its label", () => {
    const drafts = parseLoanText(PAGE);
    expect(drafts.map(read)).toEqual([
      {
        // Lainan määrä and Korko are words a page can use for another figure too: read, never sure
        grantedCents: "20000000 check",
        balanceCents: "15432109 sure",
        // 4,112 % in hundredths of a percent
        rateBp: "411 check",
        reference: "euribor_12 sure",
        marginBp: "55 sure",
        repayment: "annuity sure",
        endDate: "2044-03-05 sure",
      },
    ]);
    expect(drafts.map(warned)).toEqual([[]]);
    expect(drafts[0]!.endDate!.line).toBe("Viimeinen eräpäivä 5.3.2044");
  });

  it("the next due date and the next payment are not the last due date or the payment", () => {
    expect(parseLoanText(text("Seuraava eräpäivä", "5.11.2026", "Seuraavan erän määrä", "1 204,37 €", "Eräpäivä 5.11.2026"))).toEqual([]);
  });

  it("a balance shown with a minus is the amount owed, to check", () => {
    for (const minus of ["-", "−", "- "]) {
      expect(parseLoanText(`Lainan saldo ${minus}154 321,09 €`).map(read), minus).toEqual([{ balanceCents: "15432109 check" }]);
    }
  });

  it("a label with no value leaves its field out, and the next label still reads its own line", () => {
    const [draft] = parseLoanText(text("Lainan saldo", "7 500,00 €", "Marginaali", "Lyhennystapa", "Tasalyhennys", "Viimeinen eräpäivä", "31.12.2031"));
    // Lyhennystapa stands under a label with no value: its value is read, to check
    expect(read(draft!)).toEqual({ balanceCents: "750000 sure", repayment: "equal_principal check", endDate: "2031-12-31 sure" });
  });

  it("labels in one column and values in another are not paired", () => {
    expect(parseLoanText(text("Lainan määrä", "Lainan saldo", "150 000,00 €", "120 000,00 €"))).toEqual([]);
    // the amount under the last label is the first label's
    expect(parseLoanText(text("Lainan määrä", "Lyhennystapa", "Lainan saldo", "150 000,00 €", "Annuiteetti", "120 000,00 €"))).toEqual([]);
    expect(parseLoanText(text("Korko", "Marginaali", "3,39 %", "0,65 %"))).toEqual([]);
  });

  it("two value lines under one label are both left out", () => {
    expect(parseLoanText(text("Lainan saldo", "120 000,00 €", "150 000,00 €"))).toEqual([]);
    expect(parseLoanText(text("Viimeinen eräpäivä", "5.11.2026", "5.3.2044"))).toEqual([]);
  });

  it("a value further down than the next line is not read", () => {
    expect(parseLoanText(text("Lainan saldo", "Asuntolaina", "120 000,00 €"))).toEqual([]);
    expect(parseLoanText(text("Lainan saldo", "ei tiedossa", "Myönnetty määrä 150 000,00 €")).map(read)).toEqual([{ grantedCents: "15000000 sure" }]);
  });

  it("a label inside a sentence is no label", () => {
    expect(parseLoanText(text("Uusi korko 3,50 % tulee voimaan 1.1.2027.", "Lainasi marginaali 0,55 % säilyy.", "Tarkista lainan saldo 154 321,09 € verkkopankista."))).toEqual([]);
    expect(parseLoanText("Korkokatto 4,00 %")).toEqual([]);
  });

  it("reads euro amounts in the thousands with and without separators from the line below", () => {
    for (const form of ["154 321,09 €", "154.321,09 €", "154321,09 €", "154321,09", "154 321,09 EUR"]) {
      expect(parseLoanText(text("Jäljellä oleva lainamäärä", form, "Lainan korko", "4,112 %")).map(read), form).toEqual([{ balanceCents: "15432109 sure", rateBp: "411 sure" }]);
    }
  });

  it("a value from the line below is sure only when the text proves that values stand below their labels", () => {
    // nothing says the amount is not the value of a caption that was left out of the copy
    expect(parseLoanText(text("Lainan saldo", "12 345,67 €")).map(read)).toEqual([{ balanceCents: "1234567 check" }]);
    // the label under the value has its own value, or is of a kind the value cannot be: the value is the label's above
    expect(parseLoanText(text("Lainan saldo", "12 345,67 €", "Lainan korko 3,25 %")).map(read)).toEqual([{ balanceCents: "1234567 sure", rateBp: "325 sure" }]);
    expect(parseLoanText(text("Lainan saldo", "12 345,67 €", "Lainan korko", "3,25 %")).map(read)).toEqual([{ balanceCents: "1234567 sure", rateBp: "325 sure" }]);
    // two amounts in a row prove nothing: the second could be the first caption's on a page that puts values above
    expect(parseLoanText(text("Lainan määrä", "20 000,00 €", "Lainan saldo", "12 345,67 €")).map(read)).toEqual([{ grantedCents: "2000000 check", balanceCents: "1234567 check" }]);
  });

  it("a page that puts each value above its caption is not read as the caption below's value", () => {
    const captions = ["150 000,00 €", "Lainan määrä", "120 000,00 €", "Lainan saldo", "3,39 %", "Korko"];
    expect(parseLoanText(text(...captions))).toEqual([]);
    // copied from the first caption on, the amount under it is the next caption's: read, and never sure
    expect(parseLoanText(text(...captions.slice(1))).map(read)).toEqual([{ grantedCents: "12000000 check" }]);
  });

  it("an amount above a label and one below it: neither is the label's until the text proves the layout", () => {
    const rows = ["Nostettu määrä", "200 000,00 €", "Lainan saldo", "150 000,00 €"];
    expect(parseLoanText(text(...rows))).toEqual([]);
    expect(parseLoanText(text(...rows, "Lainan korko", "3,25 %")).map(read)).toEqual([{ balanceCents: "15000000 sure", rateBp: "325 sure" }]);
  });

  // A page that prints its main figures above their captions and a list of details below with each value under its label.
  const DETAILS = ["Lyhennystapa", "Annuiteetti", "Viitekorko", "12 kk Euribor"];

  it("the proof of a list further down does not reach an amount that stands above its caption", () => {
    // 85 000,00 is the balance; 689,20 is the payment, and a text proven as a whole read it as the balance, sure
    const [draft] = parseLoanText(text("85 000,00 €", "Lainan saldo", "689,20 €", "Kuukausierä", ...DETAILS));
    expect(read(draft!)).toEqual({ repayment: "annuity check", reference: "euribor_12 sure" });
  });

  it("the proof of a list further down does not reach a rate that stands above its caption", () => {
    // 3,25 is the rate; 0,65 is the margin
    const [draft] = parseLoanText(text("3,25 %", "Kokonaiskorko", "0,65 %", "Marginaali", "Lyhennystapa", "Annuiteetti", "Lyhennysväli 1 kk"));
    expect(read(draft!)).toEqual({ repayment: "annuity check", intervalMonths: "1 sure" });
  });

  it("the same page copied from its first caption on: the amount under the caption is read, and only the proven list is sure", () => {
    const [draft] = parseLoanText(text("Lainan saldo", "689,20 €", "Kuukausierä", ...DETAILS));
    expect(read(draft!)).toEqual({ balanceCents: "68920 check", repayment: "annuity check", reference: "euribor_12 sure" });
  });

  it("two loans in one paste: the same label again starts the next", () => {
    const second = PAGE.replace("200 000,00", "18 000,00").replace("154 321,09", "9 870,00").replace("4,112", "5,2").replace("5.3.2044", "5.9.2030");
    const drafts = parseLoanText(`${PAGE}\n${second}`);
    expect(drafts.map((d) => [d.grantedCents?.value, d.balanceCents?.value, d.rateBp?.value, d.endDate?.value])).toEqual([
      [20000000, 15432109, 411, "2044-03-05"],
      [1800000, 987000, 520, "2030-09-05"],
    ]);
    expect(drafts.map(warned)).toEqual([[], []]);
  });

  it("a balance above the loan's amount lowers both", () => {
    const [draft] = parseLoanText(text("Lainan määrä", "20 000,00 €", "Jäljellä oleva lainamäärä", "154 321,09 €"));
    expect(read(draft!)).toEqual({ grantedCents: "2000000 check", balanceCents: "15432109 check" });
    expect(warned(draft!)).toEqual(["balance_over_granted"]);
  });

  it("a word that can name another figure too is read, never sure", () => {
    // Lainan määrä can be what is left, Myönnetty luotto a card's limit, Korko the reference rate
    expect(parseLoanText("Lainan määrä 200 000,00 €").map(read)).toEqual([{ grantedCents: "20000000 check" }]);
    expect(parseLoanText("Myönnetty luotto 2 000,00 €").map(read)).toEqual([{ grantedCents: "200000 check" }]);
    expect(parseLoanText("Korko 4,11 %").map(read)).toEqual([{ rateBp: "411 check" }]);
    expect(parseLoanText(text("Lainan korko 4,11 %", "Alkuperäinen lainamäärä 200 000,00 €")).map(read)).toEqual([{ rateBp: "411 sure", grantedCents: "20000000 sure" }]);
    // the parts of the next payment are amounts, not the rate
    expect(parseLoanText(text("Lyhennys 500,00 €", "Korko 123,45 €", "Yhteensä 623,45 €"))).toEqual([]);
  });

  it("two labels of one field with different values: the first stays, to check", () => {
    const [draft] = parseLoanText(text("Kokonaiskorko 4,11 %", "Korko 4,50 %"));
    expect(read(draft!)).toEqual({ rateBp: "411 check" });
    expect(draft!.warnings.map((w) => [w.id, w.fields])).toEqual([["two_values", ["rateBp"]]]);
    expect(parseLoanText(text("Kokonaiskorko 4,11 %", "Korko 4,11 %")).map(read)).toEqual([{ rateBp: "411 sure" }]);
  });

  it("a word that can name another figure gives way to the register's own label on a later line", () => {
    // Korko may be the reference rate; Kokonaiskorko names the loan's rate
    const [draft] = parseLoanText(text("Korko 2,74 %", "Kokonaiskorko 3,39 %"));
    expect(read(draft!)).toEqual({ rateBp: "339 check" });
    expect(draft!.rateBp!.line).toBe("Kokonaiskorko 3,39 %");
    expect(draft!.warnings.map((w) => [w.id, w.fields])).toEqual([["two_values", ["rateBp"]]]);
    expect(parseLoanText(text("Korko 12,34", "Kokonaiskorko 45 %")).map((d) => [d.rateBp?.value, warned(d)])).toEqual([[4500, ["two_values", "rate_high"]]]);
    // the same value under both labels is the register's label's reading
    expect(parseLoanText(text("Korko 3,39 %", "Kokonaiskorko 3,39 %")).map(read)).toEqual([{ rateBp: "339 sure" }]);
  });

  it("OCR noise gives check, never sure", () => {
    const [draft] = parseLoanText(text("Lainan sa1do", "l54 32l,O9 €", "Viimeinen", "eräpäivä", "5.3.2O44"));
    expect(read(draft!)).toEqual({ balanceCents: "15432109 check", endDate: "2044-03-05 check" });
  });

  it("a page with no loan gives an empty list", () => {
    expect(parseLoanText(text("Verkkopankki", "Tilit", "Käyttötili FI00 1234 5600 0007 85", "Saldo 2 345,67 €", "Kortit", "Luottokortti", "Käytettävissä 1 500,00 €"))).toEqual([]);
  });
});
