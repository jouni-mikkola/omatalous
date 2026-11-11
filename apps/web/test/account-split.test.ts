import { describe, expect, it } from "vitest";
import { messageIn } from "@banking/core";
import { valuesOf } from "../src/pages/settings/AccountSplit.tsx";

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

describe("the line of an account with no agreement", () => {
  // the choice of three above it (who paid, equal, shares) cuts the costs; naming one of them reads as a contradiction under another
  it("points to the choice above and names none of its buttons", () => {
    for (const lang of ["fi", "en"] as const) {
      const line = messageIn(lang, "set.split.no_split_has_been_agreed").toLowerCase();
      expect(line).toMatch(lang === "fi" ? /yllä valitulla tavalla/ : /chosen above/);
      for (const button of ["set.acuse.by_shares", "set.acuse.equally", "set.acuse.by_who_has_paid_into"] as const) expect(line).not.toContain(messageIn(lang, button).toLowerCase());
    }
  });
});
