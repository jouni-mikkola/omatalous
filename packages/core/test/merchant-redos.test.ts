import { describe, expect, it } from "vitest";
import { cleanDescription, normalizeMerchant } from "../src/merchant.ts";
import { isBusinessPaymentText } from "../src/wording.ts";

// The answers of the functions that merchant-redos.perf.test.ts holds against a time bound: a long run of * or X in a
// bank text is read as before.
describe("a long run of * or X in a bank text", () => {
  it("names the shop around a long run as before", () => {
    expect(normalizeMerchant(`A ${"*".repeat(200)} Oy`, null)).toBe("A");
    expect(normalizeMerchant("*".repeat(200), "K-MARKET KAMPPI")).toBe("K-Market");
  });
});

describe("card masks", () => {
  it.each([
    ["XXXX XXXX 1234 KAUPPA", "KAUPPA"],
    ["**** 1234 KAUPPA", "KAUPPA"],
    ["123456XXXXXX1234 KAUPPA", "KAUPPA"],
    ["4581 **** **** 2241 KAUPPA", "KAUPPA"],
    ["XXXX-XXXX-XXXX-1234 KAUPPA", "KAUPPA"],
    ["XX ** 12 KAUPPA", "KAUPPA"],
    ["KAUPPA XXXX", "KAUPPA XXXX"],
  ])("%s is cleaned to %s", (raw, cleaned) => {
    expect(cleanDescription(raw)).toBe(cleaned);
  });

  it("reads at most 200 characters of a bank text", () => {
    const long = `KAUPPA ${"A".repeat(300)} ZZZ`;
    expect(cleanDescription(long)).toBe(cleanDescription(long.slice(0, 200)));
    expect(cleanDescription(`${"A".repeat(190)} KAUPPA`)).toBe(`${"A".repeat(190)} KAUPPA`);
  });
});

describe("isBusinessPaymentText on a long run", () => {
  it("still finds a mask", () => {
    expect(isBusinessPaymentText(`${"X".repeat(30)}1234`)).toBe(true);
    expect(isBusinessPaymentText("KAUPPA ****12")).toBe(true);
    expect(isBusinessPaymentText("X1234")).toBe(false);
  });
});
