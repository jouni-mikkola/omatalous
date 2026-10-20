import { describe, expect, it } from "vitest";
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
