import { describe, expect, it } from "vitest";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";

const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const OWN = "FI12 1234 5600 0785 41";

/** Merchant `i` of 120, spelled in letters so that nothing recognises it, and the cents it was paid: 10.00 € and up. */
const name = (i: number) => `Xq${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}z Kauppa`;
const paid = (i: number) => 1000 + i;
const eur = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

describe("the Luokittelematta answer", () => {
  const rows = Array.from({ length: 120 }, (_, i) => `2026/09/${String(1 + (i % 28)).padStart(2, "0")};-${eur(paid(i))};${OWN};;;${name(i).toUpperCase()};;EUR`);
  const content = [HEADER, ...rows].join("\n");
  const all = Array.from({ length: 120 }, (_, i) => paid(i));

  it("lists the 50 biggest merchants, and counts and adds up all 120", async () => {
    const { admin, s, member } = await setupApp();
    await seedCsv(s, admin, { content, accountName: "Käyttötili" });
    const { body } = await admin.call("GET", "/api/merchants/uncategorised");
    expect(body.items).toHaveLength(50);
    expect(body.count).toBe(120);
    expect(body.totalCents).toBe(all.reduce((a, b) => a + b, 0));
    // the biggest first, and the 50 are the biggest of the 120
    expect(body.items.map((x: { totalCents: number }) => x.totalCents)).toEqual([...all].sort((a, b) => b - a).slice(0, 50));

    // another member's rows are in neither, not even with the account shared
    const eero = await member("eero");
    expect((await eero.call("GET", "/api/merchants/uncategorised")).body).toEqual({ items: [], count: 0, totalCents: 0 });
    const accountId = (await admin.call("GET", "/api/meta")).body.accounts[0].id;
    await admin.call("PUT", `/api/accounts/${accountId}/shares/${eero.id}`);
    expect((await eero.call("GET", "/api/merchants/uncategorised")).body).toEqual({ items: [], count: 0, totalCents: 0 });

    // a rule for a merchant takes it out of the count and the sum, whether or not it was among the 50
    await admin.call("POST", "/api/rules", { field: "merchant", pattern: name(119), category: "shopping" });
    await admin.call("POST", "/api/rules", { field: "merchant", pattern: name(0), category: "shopping" });
    const after = (await admin.call("GET", "/api/merchants/uncategorised")).body;
    expect(after.count).toBe(118);
    expect(after.totalCents).toBe(all.reduce((a, b) => a + b, 0) - paid(119) - paid(0));
    expect(after.items).toHaveLength(50);
  });
});
