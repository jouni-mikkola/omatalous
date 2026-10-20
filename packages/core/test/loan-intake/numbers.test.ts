import { describe, expect, it } from "vitest";
import { parseLoanText } from "../../src/index.ts";
import { isValueOnly, readDate, readMoney, readPercent, repairDigits } from "../../src/loan-intake/values.ts";
import { read } from "./helpers.ts";

/** "value" for a plain reading, "value?" for one with doubt, "value+" for one with other text around it, null for none. */
const told = (r: { value: unknown; clean: boolean; doubt: boolean } | null) => (r ? `${r.value}${r.doubt ? "?" : ""}${r.clean ? "" : "+"}` : null);

describe("loan intake: reading one value", () => {
  it("euro amounts in the Finnish forms, in cents", () => {
    const cases: [string, string | null][] = [
      ["12 345,67 €", "1234567"],
      ["12.345,67", "1234567"],
      ["12345,67 €", "1234567"],
      ["12345 €", "1234500"],
      ["12 345", "1234500"],
      ["1 234 567,89 EUR", "123456789"],
      ["150 000 euroa", "15000000"],
      ["€ 500", "50000"],
      ["0,50 €", "50"],
      ["0 €", "0"],
      // unusual forms: read, with doubt
      ["12 345,5 €", "1234550?"],
      ["1,234.56 €", "123456?"],
      ["1234.56", "123456?"],
      ["12 345 67 €", "1234567?"],
      ["050 €", "50?"],
      ["-120 000,00 €", "12000000?"],
      // words around the amount
      ["120 000,00 yhteensä", "12000000+"],
      ["100 €/kk", "10000+"],
      // no amount the reader can be sure of
      ["10 000 € 5 vuotta", null],
      ["10 000 € ja 12 000 €", null],
      ["10 000 € (3,5 %)", null],
      ["5 10 000", null],
      ["FI49 1234", null],
      ["12 345,678 €", null],
      ["1 2345,67 €", null],
      ["0123 €", null],
      ["999 999 999 999 €", null],
      ["noin kymmenen tuhatta", null],
      ["", null],
    ];
    for (const [text, expected] of cases) expect(told(readMoney(text)), text).toBe(expected);
    // the same amount twice is one amount
    expect(told(readMoney("10 000 € (10 000,00 EUR)"))).toBe("1000000");
  });

  it("three groups of digits with no unit and no cents may be two numbers one space apart", () => {
    for (const bare of ["5 000 200", "1 250 000"]) expect(told(readMoney(bare)), bare).toBe(`${bare.replace(/ /g, "")}00?`);
    for (const whole of ["5 000 200 €", "EUR 5 000 200", "5 000 200,00", "5.000.200", "250 000"]) expect(told(readMoney(whole)), whole).toBe(`${whole.replace(/,00|\D/g, "")}00`);
    expect(parseLoanText("Luottoraja 5 000 200").map(read)).toEqual([{ limitCents: "500020000 check" }]);
  });

  it("a date beside an amount is taken when asked for, and is other text when not", () => {
    expect(readMoney("120 000,00 € (30.9.2026)", true)).toEqual({ value: 12000000, clean: true, doubt: false, date: "2026-09-30" });
    expect(readMoney("30.9.2026 120 000,00 €", true)).toEqual({ value: 12000000, clean: true, doubt: false, date: "2026-09-30" });
    expect(readMoney("120 000,00 € (30.9.2026)")).toEqual({ value: 12000000, clean: false, doubt: false });
    expect(readMoney("120 000,00 € 30.9.2026 - 31.10.2026", true)).toBeNull();
  });

  it("percentages in hundredths of a percent", () => {
    const cases: [string, string | null][] = [
      ["3,25 %", "325"],
      ["3,25%", "325"],
      ["3,25 prosenttia", "325"],
      ["0 %", "0"],
      ["12 %", "1200"],
      // thousandths round to the nearest hundredth, halves up
      ["3,487 %", "349"],
      ["2,675 %", "268"],
      ["0,004 %", "0"],
      ["3.25 %", "325?"],
      ["3 25 %", "325?"],
      ["065 %", "65?"],
      ["3,25", "325?"],
      ["3,25 % vuodessa", "325+"],
      ["325 %", null],
      ["3,2525 %", null],
      ["3,25 % + 0,5 %", null],
      ["3,25 % 12 kk", null],
      ["100 €", null],
      ["1.1.2027 alkaen 3,25 %", null],
    ];
    for (const [text, expected] of cases) expect(told(readPercent(text)), text).toBe(expected);
    expect(readPercent("-0,5 %")).toEqual({ value: 50, clean: true, doubt: false, negative: true });
  });

  it("dates as YYYY-MM-DD, real days only", () => {
    const cases: [string, string | null][] = [
      ["31.12.2031", "2031-12-31"],
      ["1.2.2031", "2031-02-01"],
      ["31. 12. 2031", "2031-12-31"],
      ["2031-12-31", "2031-12-31"],
      ["29.2.2028", "2028-02-29"],
      ["31.12.31", "2031-12-31?"],
      ["31.12.2031 asti", "2031-12-31+"],
      ["29.2.2027", null],
      ["31.2.2031", null],
      ["0.1.2031", null],
      ["1.13.2031", null],
      ["12.2031", null],
      ["1.2.2031 ja 3.4.2032", null],
      ["31.12.2031 klo 12", null],
      ["joulukuu 2031", null],
    ];
    for (const [text, expected] of cases) expect(told(readDate(text)), text).toBe(expected);
  });

  it("OCR's letters become digits only where a number stands", () => {
    expect(repairDigits("1O OOO, olo 500, O,65 l2 I5 Oy lO")).toEqual({ text: "10 000, olo 500, 0,65 12 15 Oy lO", repaired: true });
    expect(repairDigits("Ollila Oy 12 345,67 €")).toEqual({ text: "Ollila Oy 12 345,67 €", repaired: false });
    expect(told(readMoney("l2 345,67 €"))).toBe("1234567?");
    expect(told(readMoney("1O OOO €"))).toBe("1000000?");
    expect(told(readPercent("O,65 %"))).toBe("65?");
    expect(told(readDate("3l.l2.2O31"))).toBe("2031-12-31?");
  });

  it("a line of numbers and nothing else is a value with no label", () => {
    for (const line of ["120 000,00 €", "3,25 %", "31.12.2031", "12345", "120 000,00 € 3,25 %"]) expect(isValueOnly(line), line).toBe(true);
    for (const line of ["Annuiteetti", "1 kk", "12 kk Euribor", "Lainan saldo 5 €", ""]) expect(isValueOnly(line), line).toBe(false);
  });
});
