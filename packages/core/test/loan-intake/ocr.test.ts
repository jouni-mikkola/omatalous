import { describe, expect, it } from "vitest";
import { type LoanDraftKey, parseLoanText } from "../../src/index.ts";
import { read, text, warned } from "./helpers.ts";

// A made-up loan as clean text, and the same lines the way OCR of a screenshot damages them.
const ROWS: [LoanDraftKey, string][] = [
  ["grantedCents", "Myönnetty määrä 20 000,00 €"],
  ["balanceCents", "Luoton saldo 12 345,67 €"],
  ["rateBp", "Kokonaiskorko 3,25 %"],
  ["marginBp", "Marginaali 0,65 %"],
  ["paymentCents", "Kuukausierä 1 215,30 €"],
  ["endDate", "Viimeinen eräpäivä 31.12.2031"],
];
const CLEAN = text(...ROWS.map(([, line]) => line));
const SURE = { grantedCents: "2000000 sure", balanceCents: "1234567 sure", rateBp: "325 sure", marginBp: "65 sure", paymentCents: "121530 sure", endDate: "2031-12-31 sure" };
const CHECK = Object.fromEntries(Object.entries(SURE).map(([key, value]) => [key, value.replace("sure", "check")]));

describe("loan intake: OCR noise", () => {
  it("the clean text reads sure", () => {
    expect(parseLoanText(CLEAN).map(read)).toEqual([SURE]);
  });

  it("O for 0 and l or I for 1 are read as the digits, to check", () => {
    const noisy = text("Myönnetty määrä 2O OOO,OO €", "Luoton saldo l2 345,67 €", "Kokonaiskorko 3,25%", "Marginaali O,65 %", "Kuukausierä 1 2I5,3O €", "Viimeinen eräpäivä 3l.l2.2O3l");
    expect(parseLoanText(noisy).map(read)).toEqual([{ ...CHECK, rateBp: "325 sure" }]);
  });

  it("a comma read as a space or a point, or lost after a zero, is put back, to check", () => {
    const noisy = text("Myönnetty määrä 20 000 00 €", "Luoton saldo 12345.67 €", "Kokonaiskorko 3 25 %", "Marginaali 065 %", "Kuukausierä 1 215 30 €", "Viimeinen eräpäivä 31.12.31");
    expect(parseLoanText(noisy).map(read)).toEqual([CHECK]);
    expect(parseLoanText("Kokonaiskorko 3.25 %").map(read)).toEqual([{ rateBp: "325 check" }]);
    // no percent sign: the number after the label is most likely the rate
    expect(parseLoanText("Kokonaiskorko 3,25").map(read)).toEqual([{ rateBp: "325 check" }]);
  });

  it("a number that noise broke beyond repair is left out", () => {
    const broken = ["Kokonaiskorko 325 %", "Luoton saldo 12 345 6 €", "Luoton saldo 12 34567 €", "Luoton saldo 12,345,67 €", "Viimeinen eräpäivä 31.13.2031", "Marginaali O,6S %", "Kuukausierä 1 2l5,3Q €"];
    for (const line of broken) expect(parseLoanText(text("Myönnetty määrä 20 000,00 €", line)).map(read), line).toEqual([{ grantedCents: "2000000 sure" }]);
  });

  it("a label broken over two lines or read with look-alike letters gives check", () => {
    expect(parseLoanText(text("Luoton", "saldo 12 345,67 €")).map(read)).toEqual([{ balanceCents: "1234567 check" }]);
    expect(parseLoanText(text("Viimeinen", "eräpäivä", "31.12.2031")).map(read)).toEqual([{ endDate: "2031-12-31 check" }]);
    for (const label of ["Luoton sa1do", "Luoton saIdo", "Lu0ton saldo", "LUOTON SA|DO"]) expect(parseLoanText(`${label} 12 345,67 €`).map(read), label).toEqual([{ balanceCents: "1234567 check" }]);
    // letters without their dots are the same label: OCR without Finnish data, or an ASCII export
    expect(parseLoanText("Myonnetty maara 20 000,00 €").map(read)).toEqual([{ grantedCents: "2000000 sure" }]);
    expect(parseLoanText(text("Luoton", "saldo 12 345,67 €"))[0]!.balanceCents!.line).toBe("Luoton saldo 12 345,67 €");
  });

  it("a word made of look-alike letters is not a number", () => {
    // "olo" is a word, not 010: the amount is 500, and the word beside it gives check
    expect(parseLoanText("Luoton saldo olo 500 €").map(read)).toEqual([{ balanceCents: "50000 check" }]);
    expect(parseLoanText("Luotonantaja: Oy Ollila Ab").map(read)).toEqual([]);
  });

  it("a lost comma can leave a well-formed number: the cross-checks and the ocr source are what catch it", () => {
    // as text this is 68 920 €, printed as such; from a picture it may be 689,20 €
    expect(parseLoanText("Kuukausierä 68920 €").map(read)).toEqual([{ paymentCents: "6892000 sure" }]);
    expect(parseLoanText("Kuukausierä 68920 €", { source: "ocr" }).map(read)).toEqual([{ paymentCents: "6892000 check" }]);
    // 4,5 % read as 45 %
    const [high] = parseLoanText("Kokonaiskorko 45 %");
    expect([read(high!), warned(high!)]).toEqual([{ rateBp: "4500 check" }, ["rate_high"]]);
    // 12 345,67 € read as 1 234 567 €
    const [over] = parseLoanText(text("Myönnetty määrä 20 000,00 €", "Luoton saldo 1234567 €"));
    expect([read(over!), warned(over!)]).toEqual([{ grantedCents: "2000000 check", balanceCents: "123456700 check" }, ["balance_over_granted"]]);
  });

  it("with the ocr source no field is sure", () => {
    expect(parseLoanText(CLEAN, { source: "ocr" }).map(read)).toEqual([CHECK]);
  });

  it("no single damaged character turns a row into a different value that reads sure", () => {
    const base = parseLoanText(CLEAN)[0]!;
    const swaps: [RegExp, string[]][] = [
      [/0/g, ["O", "o"]],
      [/1/g, ["l", "I"]],
      [/,/g, [" ", ".", ""]],
      [/l/g, ["1", "I", "|"]],
      [/ /g, ["", "  "]],
    ];
    let tried = 0;
    ROWS.forEach(([key, line], row) => {
      for (const [from, replacements] of swaps) {
        for (const m of line.matchAll(from)) {
          for (const to of replacements) {
            const damaged = line.slice(0, m.index) + to + line.slice(m.index + 1);
            const rows = ROWS.map(([, clean], i) => (i === row ? damaged : clean));
            const field = parseLoanText(text(...rows))[0]?.[key];
            tried++;
            // the damaged row is left out, or read to check, or (a doubled space) read as the same value
            if (field && field.confidence === "sure") expect(field.value, damaged).toBe(base[key]!.value);
          }
        }
      }
    });
    expect(tried).toBeGreaterThan(80);
  });
});
