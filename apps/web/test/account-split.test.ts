import { describe, expect, it } from "vitest";
import { agreementOfUse, valuesOf, waysFor, wayOf } from "../src/pages/settings/AccountSplit.tsx";

const name = (o: string) => (o === "a" ? "Aino" : "Ville");
const fixed = (rest?: { kind: "equal" | "income" }) => ({ validFrom: "2026-01-01", kind: "fixed" as const, value: { cents: { a: 30000 }, ...(rest ? { rest } : {}) } }) as never;

describe("the line of a fixed agreement", () => {
  it("names the way the rest is split when the agreement says it", () => {
    expect(valuesOf(fixed({ kind: "income" }), name)).toContain("Loput: tulojen suhteessa");
  });
  it("says the rest is not told, never tasan, when the agreement has none", () => {
    const line = valuesOf(fixed(), name);
    expect(line).toContain("Loppuosan jakoa ei ole kerrottu");
    expect(line).not.toContain("tasan");
  });
});

describe("the ways of the one control", () => {
  it("are the use's three, and the agreement's two to a user the account weighs, with no fixed sum on a card", () => {
    expect(waysFor(false, false, false)).toEqual(["source", "equal", "percent"]);
    expect(waysFor(true, false, false)).toEqual(["source", "equal", "percent", "income", "fixed"]);
    expect(waysFor(true, true, false)).toEqual(["source", "equal", "percent", "income"]);
  });
  it("leave out who paid while an agreement is in force, as no agreement says it", () => {
    expect(waysFor(true, false, true)).toEqual(["equal", "percent", "income", "fixed"]);
  });
  it("press a share agreement as Osuuksien mukaan and the others as themselves", () => {
    expect(["equal", "share", "income", "fixed"].map((k) => wayOf(k as never))).toEqual(["equal", "percent", "income", "fixed"]);
  });
  it("say Tasan or the shares from a day as the agreement whose costs they cut", () => {
    const users = [{ userId: "a", weight: 700 }, { userId: null, weight: 300 }, { userId: "c", weight: 0 }];
    expect(agreementOfUse("equal", users)).toEqual({ kind: "equal", value: { who: ["u:a", "u:"] } });
    expect(agreementOfUse("percent", users)).toEqual({ kind: "share", value: { weights: { "u:a": 700, "u:": 300 } } });
  });
});
