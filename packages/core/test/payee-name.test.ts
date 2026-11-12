import { describe, expect, it } from "vitest";
import { householdWords, nameMayBePerson } from "../src/payee-guard.ts";

describe("nameMayBePerson", () => {
  const household = householdWords(["Matti Meikäläinen", "Elisa Korhonen"]);

  it("takes a name shaped like a person's, or holding a word of the household's, for a person's", () => {
    expect(nameMayBePerson("Pekka Virtanen", household)).toBe(true);
    expect(nameMayBePerson("Korhonen", household)).toBe(true);
  });

  it("leaves a brand a brand", () => {
    for (const brand of ["Wolt", "Alko", "Apple", "K-Market Oy", "Prisma"]) expect(nameMayBePerson(brand, household)).toBe(false);
  });
});
