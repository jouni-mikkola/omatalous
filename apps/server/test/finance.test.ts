import { CATEGORIES, REPORTS } from "@banking/core";
import { describe, expect, it } from "vitest";
import { seedCsv } from "./csv-seed.ts";
import { checkingAccount, setupApp } from "./helpers.ts";
import { isNordeaAccount } from "../../../packages/core/src/wording.ts";
import { todayIn } from "../src/platform/config.ts";
import { requestInputs, type ScopeAccount } from "../src/services/analysis.ts";

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

    // a page that shows a few sections asks for their reports only (Yhteenveto: the spending change); an unknown name is a 400
    const month = await admin.call("GET", "/api/reports?from=2026-09-01&to=2026-09-30&reports=spendingChange");
    expect(Object.keys(month.body)).toEqual(["spendingChange"]);
    expect(month.body.spendingChange.views[0].view).toBe("usual");
    expect((await admin.call("GET", "/api/reports?reports=spendingChange,nope")).res.status).toBe(400);
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

    // the cash flow file follows the one savings rate (saved / income) and ends with what stayed on the accounts
    const { body: d } = await admin.call("GET", "/api/dashboard?from=2026-09-01&to=2026-09-30");
    const t = d.totals;
    const cash = await admin.call("GET", "/api/export/report.csv?report=cashflow&from=2026-09-01&to=2026-09-30");
    const [head, row] = cash.body.replace(/^﻿/, "").split(/\r?\n/);
    expect(head).toMatch(/;Säästöaste %;Yli jäi €$/);
    const cells = row!.split(";");
    expect(cells[0]).toBe("2026-09");
    expect(Number(cells[7])).toBe(Math.round((t.savedCents / t.incomeCents) * 100));
    expect(Number(cells[8]!.replace(",", "."))).toBeCloseTo((t.incomeCents - t.expenseCents - t.savedCents) / 100, 2);
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
    expect(byMerchant("Acme")[0].kind).toBe("income");
  });

  it("the transaction list sums money in and out over every matching row, not only the page, own transfers left out", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const { body: page } = await admin.call("GET", "/api/transactions?from=2026-09-01&to=2026-09-30&limit=5");
    const { body: all } = await admin.call("GET", "/api/transactions?from=2026-09-01&to=2026-09-30&limit=5000");
    expect(page.items).toHaveLength(5);
    expect(all.items).toHaveLength(all.total);
    type Row = { amountCents: number; isTransfer: boolean };
    // an own transfer leaves one account and lands on another: in both sums it would count the same money twice
    expect(all.items.some((t: Row) => t.isTransfer)).toBe(true);
    const paid = all.items.filter((t: Row) => !t.isTransfer);
    expect(page.outCents).toBe(-paid.filter((t: Row) => t.amountCents < 0).reduce((s: number, t: Row) => s + t.amountCents, 0));
    expect(page.inCents).toBe(paid.filter((t: Row) => t.amountCents > 0).reduce((s: number, t: Row) => s + t.amountCents, 0));
    expect(page.total).toBe(all.items.length);
  });

  it("filters the list and the CSV to income with kind=income, and ignores any other kind", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const month = "from=2026-09-01&to=2026-09-30&limit=5000";
    const { body: all } = await admin.call("GET", `/api/transactions?${month}`);
    const { body: income } = await admin.call("GET", `/api/transactions?${month}&kind=income`);
    const incomeIds = new Set(CATEGORIES.filter((c) => c.kind === "income").map((c) => c.id));
    expect(income.items.length).toBeGreaterThan(0);
    expect(income.items.length).toBeLessThan(all.items.length);
    expect(income.items.every((t: { category: string }) => incomeIds.has(t.category))).toBe(true);
    expect(income.total).toBe(all.items.filter((t: { category: string }) => incomeIds.has(t.category)).length);
    const { body: other } = await admin.call("GET", `/api/transactions?${month}&kind=expense`);
    expect(other.total).toBe(all.total);
    const csv = await admin.call("GET", "/api/export/transactions.csv?from=2026-09-01&to=2026-09-30&kind=income");
    expect(String(csv.body).trim().split(/\r?\n/)).toHaveLength(income.total + 1);
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
    const { admin, s } = await setupApp();
    const content = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta\n2026/09/30;-23,45;;;;K-MARKET KAMPPI;;EUR\n2026/09/30;-23,45;;;;K-MARKET KAMPPI;;EUR\n";
    const first = await seedCsv(s, admin, { content, accountName: "Vanha tili" });
    expect(first.body).toMatchObject({ inserted: 2, skipped: 0 });
    const second = await seedCsv(s, admin, { content, accountId: first.body.accountId });
    expect(second.body).toMatchObject({ inserted: 0, updated: 2 });
    const tx = (await admin.call("GET", "/api/transactions")).body;
    expect(tx.total).toBe(2);
    expect(tx.items[0]).toMatchObject({ merchant: "K-Market", category: "groceries", own: true });
  });
});

describe("the questions of the first page", () => {
  it("rides on the dashboard, and a payee set aside leaves the list and not the share", async () => {
    const { admin, s } = await setupApp();
    // a payee in letters no rule knows, paid twice, and a salary the rules know
    const header = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
    const own = "FI12 1234 5600 0785 41";
    const content = [header, `2026/09/03;-12,50;${own};;;XQAZ KAUPPA;;EUR`, `2026/09/10;-20,00;${own};;;XQAZ KAUPPA;;EUR`, `2026/09/25;2500,00;;;ESIMERKKI OY;PALKKA;;EUR`].join("\n");
    await seedCsv(s, admin, { content, accountName: "Käyttötili" });
    const before = (await admin.call("GET", "/api/dashboard")).body.questions;
    expect(before).toMatchObject({ share: expect.any(Number), cardBillCents: expect.any(Number), items: expect.any(Array), total: expect.any(Number) });
    expect(before.share).toBeGreaterThanOrEqual(0);
    expect(before.share).toBeLessThanOrEqual(1);
    expect(before.items.length).toBeLessThanOrEqual(5);
    const payee = before.items.find((i: { kind: string }) => i.kind !== "loan");
    expect(payee, "the demo household has a payee without a category").toBeTruthy();
    await admin.call("PUT", "/api/marks", { subject: `question:payee:${payee.merchant}`, mark: "dismissed" });
    const after = (await admin.call("GET", "/api/dashboard")).body.questions;
    expect(after.items.some((i: { kind: string; merchant?: string }) => i.kind === payee.kind && i.merchant === payee.merchant)).toBe(false);
    expect(after.total).toBe(before.total - 1);
    expect({ ...after, items: [], total: 0 }).toEqual({ ...before, items: [], total: 0 });
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
    const checking = await checkingAccount(admin);
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

  it("a balance given at night counts for the local day", async () => {
    const { s, adminId } = await setupApp();
    const account = { id: "a", name: "Käyttötili", type: "checking", balanceCents: 1000, ownerName: null } as unknown as ScopeAccount;
    // 22.30 UTC on the 10th is 1.30 on the 11th in Helsinki: that morning's rows are already in the balance
    const night = await requestInputs(s, adminId, [{ ...account, balanceAt: "2026-10-10T22:30:00.000Z" }]);
    expect(night.balances[0]!.balanceAt).toBe("2026-10-11");
    const none = await requestInputs(s, adminId, [{ ...account, balanceAt: null }]);
    expect(none.balances[0]!.balanceAt).toBeNull();
  });

  it("the balances of the household view say whose account each is and when its balance was given", async () => {
    const { admin, member } = await setupApp();
    await admin.call("POST", "/api/demo");
    const eero = await member("eero", "Eero");
    await eero.call("POST", "/api/demo");
    const checking = await checkingAccount(admin);
    expect(checking.balanceAt).toEqual(expect.any(String));
    await admin.call("PUT", `/api/accounts/${checking.id}/shares/${eero.id}`);

    type Series = { accountId: string; name: string; ownerName: string | null; balanceAt: string | null };
    const household = (await eero.call("GET", "/api/reports?from=2026-01-01&to=2026-09-30&scope=household")).body.balances.accounts as Series[];
    const shared = household.find((a) => a.accountId === checking.id)!;
    // the report gets the local date of the balance, as the books count days
    expect(shared).toMatchObject({ ownerName: "Aino", balanceAt: todayIn("Europe/Helsinki", new Date(checking.balanceAt)) });
    // the viewer's own accounts carry no owner
    const own = household.filter((a) => a.accountId !== checking.id);
    expect(own.length).toBeGreaterThan(0);
    for (const a of own) expect(a, a.name).toMatchObject({ ownerName: null, balanceAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    // without the household scope the shared account is not in the report
    const alone = (await eero.call("GET", "/api/reports?from=2026-01-01&to=2026-09-30")).body.balances.accounts as Series[];
    expect(alone.some((a) => a.accountId === checking.id)).toBe(false);
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

  it("reads my copy of a joint account the partner linked too as one account of two users, so the income report splits it between them", async () => {
    const { admin, s, adminId, member } = await setupApp();
    const eero = await member("eero", "Eero");
    const account = (id: string, identity: string) => ({ id, connectionId: null, provider: "csv", externalId: null, identity, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" as const });
    await s.finance(adminId).upsertAccount(account("aino-joint", "joint"));
    await s.finance(adminId).upsertAccount(account("aino-own", "aino"));
    await s.finance(eero.id).upsertAccount(account("eero-joint", "joint"));
    for (const id of ["aino-joint", "aino-own"]) expect((await admin.call("PUT", `/api/accounts/${id}/shares/${eero.id}`)).status).toBe(200);

    const reports = (await eero.call("GET", "/api/reports?from=2026-01-01&to=2026-09-30&scope=household")).body;
    // neither has income here, and two equal members come in the order of their ids
    expect(reports.income.members.map((m: { label: string }) => m.label).sort()).toEqual(["Aino", "Eero"]);
  });
});

describe("bank connection status", () => {
  it("shows a consent past its end date as lapsed without writing it, days left only while active", async () => {
    const { admin, s, adminId } = await setupApp();
    const repo = s.finance(adminId);
    const consent = (id: string, validUntil: string) =>
      repo.upsertConnection({ id, provider: "enablebanking", institution: "Nordea", country: "FI", status: "active", validUntil, createdAt: "2026-04-01T00:00:00Z", lastSyncedAt: null });
    await consent("ended", "2026-10-08T00:00:00Z");
    await consent("last-day", "2026-10-09T23:00:00Z");

    const byId = new Map((await admin.call("GET", "/api/meta")).body.connections.map((c: { id: string }) => [c.id, c]));
    expect(byId.get("ended")).toMatchObject({ status: "expired", state: "lapsed", daysLeft: null });
    expect(byId.get("last-day")).toMatchObject({ status: "active", state: "active", daysLeft: 0 });
    expect((await repo.listConnections()).every((c) => c.status === "active")).toBe(true);
  });

  it("an account carries the bank of its connection, and none without a connection", async () => {
    const { s, adminId } = await setupApp();
    const repo = s.finance(adminId);
    const consent = (id: string, institution: string) =>
      repo.upsertConnection({ id, provider: "enablebanking", institution, country: "FI", status: "active", validUntil: "2027-01-01T00:00:00Z", createdAt: "2026-04-01T00:00:00Z", lastSyncedAt: null });
    await consent("c-nordea", "Nordea");
    await consent("c-other", "Bank Norwegian");
    const card = (id: string, connectionId: string | null) =>
      repo.upsertAccount({ id, connectionId, provider: connectionId ? "enablebanking" : "csv", externalId: null, identity: id, name: id, iban: null, currency: "EUR", type: "credit_card" });
    await card("card-nordea", "c-nordea");
    await card("card-other", "c-other");
    await card("card-file", null);
    const bankOf = new Map((await repo.listAccounts()).map((a) => [a.id, a.bank]));
    expect([bankOf.get("card-nordea"), bankOf.get("card-other"), bankOf.get("card-file")]).toEqual(["Nordea", "Bank Norwegian", null]);
    expect((await repo.getAccount("card-other"))!.bank).toBe("Bank Norwegian");
    // what Optimoi asks of the stored accounts: the card from another bank's connection is not Nordea's
    expect((await repo.listAccounts()).filter((a) => isNordeaAccount(a)).map((a) => a.id).sort()).toEqual(["card-file", "card-nordea"]);
  });

  it("the API gives an account's bank to its owner, and a member the account is shared with learns nothing new from it", async () => {
    const { s, admin, adminId, member } = await setupApp();
    const repo = s.finance(adminId);
    await repo.upsertConnection({ id: "c-other", provider: "enablebanking", institution: "Bank Norwegian", country: "FI", status: "active", validUntil: "2027-01-01T00:00:00Z", createdAt: "2026-04-01T00:00:00Z", lastSyncedAt: null });
    await repo.upsertAccount({ id: "card-other", connectionId: "c-other", provider: "enablebanking", externalId: null, identity: "card-other", name: "Platinum", iban: null, currency: "EUR", type: "credit_card" });
    const eero = await member("eero", "Eero");
    expect((await admin.call("PUT", `/api/accounts/card-other/shares/${eero.id}`)).status).toBe(200);
    const own = (await admin.call("GET", "/api/meta")).body.accounts[0];
    expect(own).toMatchObject({ id: "card-other", bank: "Bank Norwegian" });
    const shared = (await eero.call("GET", "/api/meta")).body.sharedAccounts[0];
    expect(shared).toMatchObject({ id: "card-other", name: "Platinum", ownerName: "Aino" });
    // the member's copy has the keys of the owner's and the owner's name, and no bank: a card has no IBAN to tell it
    expect(Object.keys(shared).sort()).toEqual([...Object.keys(own).filter((k) => k !== "problem" && k !== "bank"), "ownerName"].sort());
    // the analysis of the household view has it, so the member's Optimoi does not take the card for Nordea's
    const inView = await s.household.sharedWith(eero.id);
    expect(inView.map((a) => [a.id, a.bank, isNordeaAccount(a)])).toEqual([["card-other", "Bank Norwegian", false]]);
  });
});
