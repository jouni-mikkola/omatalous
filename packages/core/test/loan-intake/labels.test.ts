import { describe, expect, it } from "vitest";
import { type LoanDraftValues, type LoanReference, fold } from "../../src/index.ts";
import { LOAN_LABELS, LOAN_LABELS_UNSURE, type LoanLabelField, isLoanLenderLine, isLoanOtherUnit, isLoanRateFormula, isLoanTotal, loanLabelsIn, loanMoneyUnit, loanPercentUnit } from "../../src/wording-loan-pages.ts";

const phrases = [LOAN_LABELS, LOAN_LABELS_UNSURE].flatMap((lists) => (Object.entries(lists) as [LoanLabelField, string][]).flatMap(([field, list]) => list.split("|").map((label) => ({ field, label }))));
const fieldsOf = (text: string) => loanLabelsIn(fold(text)).map((h) => h.field);

describe("loan intake: the label lists of wording-loan-pages.ts", () => {
  it("every label is a plain phrase, and no phrase names two fields, also with look-alike letters collapsed", () => {
    for (const { label } of phrases) expect(label, label).toMatch(/^[A-Z]+(?:[ -][A-Z]+)*$/);
    const collapsed = phrases.map((p) => p.label.replace(/[1L|]/g, "I").replace(/0/g, "O"));
    expect(new Set(phrases.map((p) => p.label)).size).toBe(phrases.length);
    expect(new Set(collapsed).size).toBe(phrases.length);
  });

  it("the register's and the SECCI form's labels name their fields", () => {
    const labels: [string, LoanLabelField][] = [
      ["Myönnetty määrä", "grantedCents"],
      ["Luoton kokonaismäärä", "grantedCents"],
      ["Luoton saldo", "balanceCents"],
      ["Kokonaiskorko", "rateBp"],
      ["Lainakorko", "rateBp"],
      ["Viitekorko", "reference"],
      ["Marginaali", "marginBp"],
      ["Lyhennystapa", "repayment"],
      ["Lyhennysväli", "intervalMonths"],
      ["Kuukausierä", "paymentCents"],
      ["Lyhennys", "amortisationCents"],
      ["Viimeinen eräpäivä", "endDate"],
      ["Luottoraja", "limitCents"],
      ["Luotonantaja", "lender"],
    ];
    for (const [label, field] of labels) {
      expect(loanLabelsIn(fold(`${label}: 1`)), label).toEqual([{ field, label: fold(label), start: 0, end: label.length, exact: true, certain: true }]);
    }
  });

  it("a label is a whole word: a longer word that holds it is another thing", () => {
    for (const other of ["Todellinen vuosikorko", "Viivästyskorko", "Korkokatto", "Talletuskorko", "Luotonantajan osoite", "Luottorajan ylitys", "Tilin saldo", "Seuraava eräpäivä", "Maksuerät", "Lyhennysvapaa", "Tasalyhennys"]) {
      expect(fieldsOf(other), other).toEqual([]);
    }
    expect(fieldsOf("Viitekorko")).toEqual(["reference"]);
    // a word of the unsure list is found and marked
    expect(loanLabelsIn("KORKO 3 %").map((h) => [h.field, h.certain])).toEqual([["rateBp", false]]);
    expect(loanLabelsIn("LAINAN MAARA").map((h) => [h.field, h.certain])).toEqual([["grantedCents", false]]);
    expect(fieldsOf("Korkomarginaali")).toEqual(["marginBp"]);
    // the longest phrase wins
    expect(loanLabelsIn("LAINAN KORKO 3 %").map((h) => h.label)).toEqual(["LAINAN KORKO"]);
    expect(loanLabelsIn("KUUKAUSIERAN SUURUUS").map((h) => h.label)).toEqual(["KUUKAUSIERAN SUURUUS"]);
    expect(loanLabelsIn("LUOTON   SALDO").map((h) => [h.label, h.exact])).toEqual([["LUOTON SALDO", true]]);
  });

  it("a label read with look-alike letters is found and marked", () => {
    for (const noisy of ["LUOTON SA1DO", "IUOTON SAIDO", "LU0TON SALDO", "LUOTON SA|DO"]) {
      expect(loanLabelsIn(noisy).map((h) => [h.field, h.label, h.exact]), noisy).toEqual([["balanceCents", "LUOTON SALDO", false]]);
    }
    // the loose reading of a longer label wins over the exact reading of a part of it
    expect(loanLabelsIn("IAINAN KORKO").map((h) => [h.label, h.exact])).toEqual([["LAINAN KORKO", false]]);
    expect(loanLabelsIn("LUOTON SALDO 10 000").map((h) => h.exact)).toEqual([true]);
  });

  it("a lender's line names a bank or a finance company", () => {
    for (const name of ["Esimerkkipankki Oyj", "Mallirahoitus Bank AB", "S-Pankki", "Esimerkki Finance Oy", "Mallin Osuuspankki", "Malliluotto Oy", "Esimerkki A/S"]) expect(isLoanLenderLine(fold(name)), name).toBe(true);
    for (const other of ["Verkkopankki", "Asunto Oy Mallila", "As Oy Mallila", "Koy Mallila", "Pankkitunnukset", "Malli Vahinkovakuutus Oyj", "Asuntolaina", "Oyster"]) expect(isLoanLenderLine(fold(other)), other).toBe(false);
  });

  it("a rate written as its parts is told apart from a rate", () => {
    for (const formula of ["3 KK EURIBOR + 4,50 %", "VIITEKORKO JA MARGINAALI 4,50 %", "PRIME 2 %"]) expect(isLoanRateFormula(formula), formula).toBe(true);
    for (const plain of [" 7,90 %", " 7,90 % KIINTEA"]) expect(isLoanRateFormula(plain), plain).toBe(false);
  });

  it("the total of a listing and the units after a number are word lists too", () => {
    expect(["LUOTON SALDO YHTEENSA 1", " YHTEENSA: 2", "YHTEENSATTUMA", "ERA 1"].map(isLoanTotal)).toEqual([true, true, false, false]);
    expect([" €", " EUR", " euroa", "e", " erää", " kk"].map(loanMoneyUnit)).toEqual([" €", " EUR", " euroa", "e", null, null]);
    expect([" %", " prosenttia", " pros.", " €"].map(loanPercentUnit)).toEqual([" %", " prosenttia", " pros.", null]);
    expect([" kk", " vuotta", " erää", "x", " €", " %", ""].map(isLoanOtherUnit)).toEqual([true, true, true, true, false, false, false]);
  });

  it("the draft's reference ids are the ones the rest of the app uses", () => {
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const same: Same<LoanDraftValues["reference"], LoanReference> = true;
    expect(same).toBe(true);
  });
});
