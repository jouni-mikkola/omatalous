import { describe, expect, test } from "vitest";
import { categorize, compileRules } from "../src/categorize.ts";
import { categoryForMcc } from "../src/categorize-mcc.ts";
import { isGamblingMcc } from "../src/wording-gambling.ts";

describe("merchant code is only digits", () => {
  test("text after digits is not evidence", () => {
    for (const bad of ["5812abc", "5812.9", " ", "-5812"]) expect(categoryForMcc(bad)).toBeNull();
    expect(isGamblingMcc("7995x")).toBe(false);
  });
  test("plain codes read as before", () => {
    expect(categoryForMcc("5812")).toBe("restaurants");
    expect(categoryForMcc(null)).toBeNull();
    expect(isGamblingMcc("7995")).toBe(true);
  });
});

describe("a text code reaches the gambling word rule as an unknown code", () => {
  const rules = compileRules([]);
  const cat = (mcc: string) =>
    categorize({ merchant: "CASINO HELSINKI", counterparty: "CASINO HELSINKI", description: null, mcc, counterpartyIban: null, amountCents: -2000 }, rules).category;
  test("5812abc is handled like abc, 5812 stays a restaurant's code", () => {
    expect(cat("5812abc")).toBe(cat("abc"));
    expect(cat("5812abc")).toBe("gambling");
    expect(cat("5812")).not.toBe("gambling");
  });
});
