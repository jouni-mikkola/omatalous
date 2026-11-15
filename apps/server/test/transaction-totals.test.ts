import { describe, expect, it } from "vitest";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";

const csv = (rows: string[]) => ["Kirjauspäivä;Määrä;Nimi;Otsikko", ...rows].join("\n");

describe("Tapahtumat totals", () => {
  it("add the rows the filter shows, without the money moved between own accounts", async () => {
    const app = await setupApp();
    await seedCsv(app.s, app.admin, {
      content: csv(["2026/08/20;-40,00;Ruokakauppa;Ostos", "2026/09/03;-25,50;Ruokakauppa;Ostos", "2026/09/05;-500,00;Oma Säästötili;Siirto", "2026/09/15;2000,00;Työnantaja Oy;Palkka"]),
      accountName: "Käyttötili",
      accountType: "checking",
    });
    await seedCsv(app.s, app.admin, { content: csv(["2026/09/05;500,00;Oma Käyttötili;Siirto"]), accountName: "Säästötili", accountType: "savings" });
    const moved = (await app.s.finance(app.adminId).allTransactions()).filter((t) => t.isTransfer).map((t) => t.amountCents);
    expect(moved.sort((a, b) => a - b)).toEqual([-50000, 50000]);

    const september = (await app.admin.call("GET", "/api/transactions?from=2026-09-01&to=2026-09-30")).body;
    // the pair is listed, and in neither sum
    expect(september.total).toBe(4);
    expect(september).toMatchObject({ outCents: 2550, inCents: 200000 });
    const all = (await app.admin.call("GET", "/api/transactions")).body;
    expect(all).toMatchObject({ total: 5, outCents: 6550, inCents: 200000 });
  });
});
