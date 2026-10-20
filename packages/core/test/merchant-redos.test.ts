import { describe, expect, it } from "vitest";
import { cleanDescription, normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { isBusinessPaymentText } from "../src/wording.ts";
import { tx } from "./helpers.ts";

// A bank text with a long run of * or X once took seconds from 36 characters on and years from 50: the card mask
// regex tried every way of splitting the run. Each case runs three times and the fastest counts. Fixed, a case takes
// a few milliseconds; the bound of a second holds on a loaded machine, and before the fix none of them returned at all.
const BOUND_MS = 1000;
const runs = (n: number) => [
  ["*", "*".repeat(n)],
  ["X", "X".repeat(n)],
  ["x", "x".repeat(n)],
  ["X*X*", "X*".repeat(n / 2)],
  ["A ****…**** Oy", `A ${"*".repeat(n)} Oy`],
  ["A XXXX…XXXX Oy", `A ${"X".repeat(n)} Oy`],
] as const;
const cases = [200, 2000].flatMap((n) => runs(n).map(([shape, text]) => [`${n} × ${shape}`, text] as const));

function fastest(f: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    f();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

describe("a long run of * or X in a bank text", () => {
  it.each(cases)("normalizeMerchant returns at once: %s", (_, text) => {
    normalizeMerchant("K-MARKET", null);
    expect(fastest(() => normalizeMerchant(text, null))).toBeLessThan(BOUND_MS);
    expect(fastest(() => normalizeMerchant(null, text))).toBeLessThan(BOUND_MS);
  });

  it.each(cases)("enrichTransactions returns at once: %s", (_, text) => {
    const rows = [tx({ bookingDate: "2026-01-02", amountCents: -1200, counterparty: text }), tx({ bookingDate: "2026-01-03", amountCents: -1200, description: text })];
    expect(fastest(() => enrichTransactions(rows, [], []))).toBeLessThan(BOUND_MS);
  });

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
  // fixed, 200 000 X take about a millisecond; before, the run was read again from each place in it, a minute or more
  it("returns at once on 200 000 X or * and still finds a mask", () => {
    isBusinessPaymentText("XXXX1234");
    for (const c of ["X", "*"]) expect(fastest(() => isBusinessPaymentText(c.repeat(200_000)))).toBeLessThan(BOUND_MS);
    expect(isBusinessPaymentText(`${"X".repeat(30)}1234`)).toBe(true);
    expect(isBusinessPaymentText("KAUPPA ****12")).toBe(true);
    expect(isBusinessPaymentText("X1234")).toBe(false);
  });
});
