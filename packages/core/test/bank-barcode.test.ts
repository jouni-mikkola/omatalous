/** The bank barcode of a bill: versions 4 and 5, and every way a wrong paste fails. The codes are made up. */
import { describe, expect, it } from "vitest";
import { parseBankBarcode } from "../src/bank-barcode.ts";

const V4 = "421123456000007850001234500000000000000000123453261231";
const V5 = "521123456000007850001234597000000000000000123456000000";

const failure = (text: string) => {
  const r = parseBankBarcode(text);
  return r.ok ? null : r.failure;
};

describe("parseBankBarcode", () => {
  it("reads version 4: IBAN, sum, Finnish reference, due date", () => {
    expect(parseBankBarcode(V4)).toEqual({
      ok: true,
      barcode: { version: 4, iban: "FI2112345600000785", cents: 12345, reference: "123453", dueDate: "2026-12-31" },
    });
  });

  it("reads version 5 with an RF reference and no due date, ignoring spaces", () => {
    const spaced = V5.replace(/(.{6})/g, "$1 ");
    expect(parseBankBarcode(spaced)).toEqual({
      ok: true,
      barcode: { version: 5, iban: "FI2112345600000785", cents: 12345, reference: "RF97123456", dueDate: null },
    });
  });

  it("refuses a wrong length, letters and an unknown version", () => {
    expect(failure(V4.slice(1))).toBe("length");
    expect(failure(`${V4}0`)).toBe("length");
    expect(failure(`${V4.slice(0, 53)}x`)).toBe("length");
    expect(failure(`3${V4.slice(1)}`)).toBe("version");
  });

  it("refuses a bad IBAN check, a bad reference check and a date that does not exist", () => {
    expect(failure(`${V4.slice(0, 16)}6${V4.slice(17)}`)).toBe("iban");
    expect(failure(`${V4.slice(0, 47)}4${V4.slice(48)}`)).toBe("reference");
    expect(failure(`${V5.slice(0, 47)}7${V5.slice(48)}`)).toBe("reference");
    expect(failure(`${V4.slice(0, 48)}261331`)).toBe("date");
    expect(failure(`${V4.slice(0, 48)}260230`)).toBe("date");
  });
});
