import { describe, expect, it } from "vitest";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";

const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const content = [HEADER, "2026/09/05;-44,15;FI12 1234 5600 0785 41;;;ESIMERKKI BENSA;;EUR"].join("\n");

type Rule = { id: number; field: string; pattern: string; category: string };
const post = (c: { call: (m: string, p: string, b?: unknown) => Promise<{ status: number; body: any }> }, pattern: string, category: string, field = "merchant_exact") =>
  c.call("POST", "/api/rules", { field, pattern, category });

describe("POST /api/rules is an upsert on field and pattern", () => {
  it("three identical posts store one rule", async () => {
    const { admin } = await setupApp();
    for (let i = 0; i < 3; i++) expect((await post(admin, "Esimerkki Bensa", "groceries")).status).toBe(200);
    expect((await admin.call("GET", "/api/rules")).body.rules).toHaveLength(1);
  });

  it("another category replaces the older answer, spacing and case compared as matching does", async () => {
    const { admin, s } = await setupApp();
    await seedCsv(s, admin, { content, accountName: "Käyttötili" });
    await post(admin, "Esimerkki Bensa", "groceries");
    const rows = async () => (await admin.call("GET", "/api/transactions")).body.items.map((t: { category: string }) => t.category);
    expect(await rows()).toEqual(["groceries"]);
    expect((await post(admin, " esimerkki  bensa ", "restaurants")).body.changed).toBe(1);
    const rules: Rule[] = (await admin.call("GET", "/api/rules")).body.rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]!.category).toBe("restaurants");
    expect(await rows()).toEqual(["restaurants"]);
  });

  it("another user's rule with the same pattern is theirs alone", async () => {
    const { admin, member } = await setupApp();
    const ville = await member("ville");
    await post(admin, "Esimerkki Bensa", "groceries");
    await post(ville, "Esimerkki Bensa", "restaurants");
    await post(ville, "Esimerkki Bensa", "restaurants");
    expect((await admin.call("GET", "/api/rules")).body.rules.map((r: Rule) => r.category)).toEqual(["groceries"]);
    expect((await ville.call("GET", "/api/rules")).body.rules.map((r: Rule) => r.category)).toEqual(["restaurants"]);
  });
});
