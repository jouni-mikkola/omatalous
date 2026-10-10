import { REPORTS } from "@banking/core";
import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

describe("dashboard and reports on demo data", () => {
  it("counts every money flow once: Gold bill, financing, savings, investments, credit draw", async () => {
    const { admin } = await setupApp();
    const seeded = await admin.call("POST", "/api/demo");
    expect(seeded.body.transactions).toBeGreaterThan(500);

    const { body: d } = await admin.call("GET", "/api/dashboard?from=2026-09-01&to=2026-09-30");
    expect(d.totals.incomeCents).toBeGreaterThanOrEqual(342000);
    expect(d.totals.debtCents).toBe(28900); // Nordea Rahoitus car financing
    expect(d.totals.savedCents).toBe(30000 + 15000); // savings account + Nordnet
    expect(d.totals.borrowedCents).toBe(0);
    const categories = d.categories.map((c: { category: string }) => c.category);
    expect(categories).not.toContain("transfer");
    expect(categories).not.toContain("card_bill"); // Gold bill to Nordea Rahoitus is a transfer
    expect(categories).toContain("loans");
    expect(d.trend.series.length).toBeLessThanOrEqual(8);

    // the month the Gold credit line was drawn to checking: both legs are transfers, nothing is "borrowed"
    const drawMonth = await admin.call("GET", "/api/dashboard?from=2026-04-01&to=2026-04-30");
    expect(drawMonth.body.totals.borrowedCents).toBe(0);
  });

  it("serves every registered report and they agree with each other", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const { body: r } = await admin.call("GET", "/api/reports?from=2025-10-01&to=2026-09-30");
    // every report in the registry is served, so a new report cannot be forgotten here
    expect(Object.keys(r).sort()).toEqual(Object.keys(REPORTS).sort());
    expect(r.cashflow.rows).toHaveLength(12);
    expect(r.categories.totalCents).toBe(r.cashflow.totals.consumptionCents + r.cashflow.totals.debtCents);
    expect(r.pivot.totalCents).toBe(r.categories.totalCents);
    expect(r.balances.accounts).toHaveLength(3);
    expect(r.balances.accounts.every((a: { values: unknown[] }) => a.values.length === 12)).toBe(true);
  });

  it("exports CSV for spreadsheets", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const tx = await admin.call("GET", "/api/export/transactions.csv?from=2026-09-01&to=2026-09-30");
    expect(tx.res.headers.get("content-type")).toContain("text/csv");
    // Response.text() strips the BOM; the csv() unit test checks it is there
    expect(tx.body).toMatch(/^\uFEFF?Päivä;Tili;Kauppias/);
    const pivot = await admin.call("GET", "/api/export/report.csv?report=pivot&from=2026-01-01&to=2026-09-30");
    expect(pivot.body).toContain("Yhteensä");
    expect(pivot.body).toMatch(/\d,\d/); // decimal comma
  });

  it("finds subscriptions, the price change, the new and the cancelled one", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const { body } = await admin.call("GET", "/api/recurring");
    const byMerchant = (m: string) => body.series.filter((s: { merchant: string }) => s.merchant === m);
    expect(byMerchant("Spotify")[0]).toMatchObject({ kind: "subscription", cadence: "monthly", active: true, typicalAmountCents: 1199 });
    expect(byMerchant("Netflix")[0].priceChange).toMatchObject({ fromCents: 1599, toCents: 1799 });
    expect(byMerchant("Disney+")[0].active).toBe(false);
    expect(byMerchant("OpenAI")[0]).toMatchObject({ kind: "subscription", active: true });
    expect(byMerchant("Apple").map((s: { typicalAmountCents: number }) => s.typicalAmountCents).sort((a: number, b: number) => a - b)).toEqual([99, 1299]);
    expect(byMerchant("Wolt")[0].kind).toBe("habit");
    expect(byMerchant("Acme Oy")[0].kind).toBe("income");
  });

  it("the transaction list sums money in and out over every matching row, not only the page", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const { body: page } = await admin.call("GET", "/api/transactions?from=2026-09-01&to=2026-09-30&limit=5");
    const { body: all } = await admin.call("GET", "/api/transactions?from=2026-09-01&to=2026-09-30&limit=5000");
    expect(page.items).toHaveLength(5);
    expect(all.items).toHaveLength(all.total);
    type Row = { amountCents: number };
    expect(page.outCents).toBe(-all.items.filter((t: Row) => t.amountCents < 0).reduce((s: number, t: Row) => s + t.amountCents, 0));
    expect(page.inCents).toBe(all.items.filter((t: Row) => t.amountCents > 0).reduce((s: number, t: Row) => s + t.amountCents, 0));
  });

  it("lets the user recategorise and remembers it as a rule", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const { body: list } = await admin.call("GET", "/api/transactions?merchant=Wolt&limit=5");
    const { body: updated } = await admin.call("PATCH", `/api/transactions/${list.items[0].id}`, { category: "restaurants", createRule: true });
    expect(updated.transaction).toMatchObject({ category: "restaurants", categorySource: "user" });
    expect(updated.transaction).not.toHaveProperty("raw");
    const { body: after } = await admin.call("GET", "/api/transactions?merchant=Wolt&limit=500");
    expect(after.items.every((t: { category: string }) => t.category === "restaurants")).toBe(true);
    // every Wolt row moved, the clicked one included
    expect(updated.changed).toBe(after.total);
    expect((await admin.call("GET", "/api/rules")).body.rules).toMatchObject([{ field: "merchant_exact", pattern: "Wolt", category: "restaurants" }]);
  });

  it("a rule made from the transaction list counts toward the rule cap", async () => {
    const { admin, s, adminId } = await setupApp();
    await admin.call("POST", "/api/demo");
    const repo = s.finance(adminId);
    for (let i = 0; i < 299; i++) await repo.addRule({ field: "description", pattern: `SAANTO ${i}`, category: "other", priority: 10 });
    await repo.setMerchantRule("Wolt", "restaurants");
    const first = async (merchant: string) => (await admin.call("GET", `/api/transactions?merchant=${merchant}&limit=1`)).body.items[0];

    // replacing this merchant's own rule keeps the count
    const wolt = await first("Wolt");
    expect((await admin.call("PATCH", `/api/transactions/${wolt.id}`, { category: "food_delivery", createRule: true })).status).toBe(200);

    const other = await first("Lidl");
    const refused = await admin.call("PATCH", `/api/transactions/${other.id}`, { category: "shopping", createRule: true });
    expect(refused).toMatchObject({ status: 400, body: { error: "Sääntöjä voi olla enintään 300." } });
    expect(await repo.ruleCount()).toBe(300);
    expect(await first("Lidl")).toMatchObject({ category: other.category, categorySource: other.categorySource });
    // without a rule the change itself is fine
    expect((await admin.call("PATCH", `/api/transactions/${other.id}`, { category: "shopping" })).status).toBe(200);
  });

  it("imports a CSV once, even when imported twice", async () => {
    const { admin } = await setupApp();
    const content = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta\n2026/09/30;-23,45;;;;K-MARKET KAMPPI;;EUR\n2026/09/30;-23,45;;;;K-MARKET KAMPPI;;EUR\n";
    const first = await admin.call("POST", "/api/import/csv", { content, accountName: "Vanha tili" });
    expect(first.body).toMatchObject({ inserted: 2, skipped: 0 });
    const second = await admin.call("POST", "/api/import/csv", { content, accountId: first.body.accountId });
    expect(second.body).toMatchObject({ inserted: 0, updated: 2 });
    const tx = (await admin.call("GET", "/api/transactions")).body;
    expect(tx.total).toBe(2);
    expect(tx.items[0]).toMatchObject({ merchant: "K-Market", category: "groceries", own: true });
  });
});

describe("isolation between household members", () => {
  it("a member sees none of another member's data and cannot change it", async () => {
    const { admin, member } = await setupApp();
    await admin.call("POST", "/api/demo");
    const eero = await member("eero");
    const adminTx = (await admin.call("GET", "/api/transactions?limit=1")).body.items[0];
    const adminAccount = (await admin.call("GET", "/api/meta")).body.accounts[0];

    expect((await eero.call("GET", "/api/transactions")).body.total).toBe(0);
    expect((await eero.call("GET", "/api/meta")).body.accounts).toEqual([]);
    expect((await eero.call("GET", "/api/dashboard")).body.totals.expenseCents).toBe(0);
    expect((await eero.call("PATCH", `/api/transactions/${adminTx.id}`, { category: "travel" })).status).toBe(404);
    expect((await eero.call("PATCH", `/api/accounts/${adminAccount.id}`, { name: "kaapattu" })).status).toBe(404);
    expect((await eero.call("PUT", `/api/accounts/${adminAccount.id}/shares/${eero.id}`)).status).toBe(400);
    expect((await eero.call("GET", "/api/export/transactions.csv")).body.split("\r\n").filter(Boolean)).toHaveLength(1);
    // the admin's data is untouched
    expect((await admin.call("GET", `/api/transactions?limit=1`)).body.items[0].category).toBe(adminTx.category);
  });

  it("sharing an account adds it to the member's household view only, read-only", async () => {
    const { admin, member } = await setupApp();
    await admin.call("POST", "/api/demo");
    const eero = await member("eero", "Eero");
    await eero.call("POST", "/api/demo");
    const checking = (await admin.call("GET", "/api/meta")).body.accounts.find((a: { type: string }) => a.type === "checking");
    expect((await admin.call("PUT", `/api/accounts/${checking.id}/shares/${eero.id}`)).status).toBe(200);

    const meta = (await eero.call("GET", "/api/meta")).body;
    expect(meta.sharedAccounts).toHaveLength(1);
    expect(meta.sharedAccounts[0]).toMatchObject({ id: checking.id, ownerName: "Aino" });

    const own = await eero.call("GET", "/api/dashboard?from=2026-09-01&to=2026-09-30");
    const household = await eero.call("GET", "/api/dashboard?from=2026-09-01&to=2026-09-30&scope=household");
    expect(household.body.totals.incomeCents).toBeGreaterThan(own.body.totals.incomeCents);

    const shared = (await eero.call("GET", `/api/transactions?scope=household&accountId=${checking.id}&limit=1`)).body.items[0];
    expect(shared.own).toBe(false);
    expect((await eero.call("PATCH", `/api/transactions/${shared.id}`, { category: "travel" })).status).toBe(404);

    await admin.call("DELETE", `/api/accounts/${checking.id}/shares/${eero.id}`);
    expect((await eero.call("GET", "/api/meta")).body.sharedAccounts).toHaveLength(0);
  });

  it("a joint account linked by both partners is listed once, like the household view counts it", async () => {
    const { admin, s, adminId, member } = await setupApp();
    const eero = await member("eero", "Eero");
    const account = (id: string, identity: string) => ({ id, connectionId: null, provider: "csv", externalId: null, identity, name: id, iban: null, currency: "EUR", type: "checking" as const });
    await s.finance(adminId).upsertAccount(account("aino-joint", "joint"));
    await s.finance(adminId).upsertAccount(account("aino-own", "aino"));
    await s.finance(eero.id).upsertAccount(account("eero-joint", "joint"));
    for (const id of ["aino-joint", "aino-own"]) expect((await admin.call("PUT", `/api/accounts/${id}/shares/${eero.id}`)).status).toBe(200);

    const meta = (await eero.call("GET", "/api/meta")).body;
    expect(meta.sharedAccounts.map((a: { id: string }) => a.id)).toEqual(["aino-own"]);
  });
});

describe("bank connection status", () => {
  it("shows a consent past its end date as expired without writing it, days left never negative", async () => {
    const { admin, s, adminId } = await setupApp();
    const repo = s.finance(adminId);
    const consent = (id: string, validUntil: string) =>
      repo.upsertConnection({ id, provider: "enablebanking", institution: "Nordea", country: "FI", status: "active", validUntil, createdAt: "2026-04-01T00:00:00Z", lastSyncedAt: null });
    await consent("ended", "2026-10-08T00:00:00Z");
    await consent("last-day", "2026-10-09T23:00:00Z");

    const byId = new Map((await admin.call("GET", "/api/meta")).body.connections.map((c: { id: string }) => [c.id, c]));
    expect(byId.get("ended")).toMatchObject({ status: "expired", daysLeft: 0 });
    expect(byId.get("last-day")).toMatchObject({ status: "active", daysLeft: 0 });
    expect((await repo.listConnections()).every((c) => c.status === "active")).toBe(true);
  });
});
