import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RawTransaction } from "@banking/core";
import { AnalysisCache } from "../src/services/analysis.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { mockBank } from "./mock-bank.ts";
import { setupApp, waitFor } from "./helpers.ts";

const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const OWN = "FI12 1234 5600 0785 41";
const csvOf = (n: number, shop = "KAUPPA") =>
  [HEADER, ...Array.from({ length: n }, (_, i) => `2026/09/${String(1 + (i % 28)).padStart(2, "0")};-${5 + i},00;${OWN};;;${shop} ${i};;EUR`)].join("\n");

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const raw = (bookingDate: string, euros: number, counterparty: string, extra: Partial<RawTransaction> = {}): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description: null, reference: null, mcc: null, ...extra,
});

async function account(repo: ReturnType<Awaited<ReturnType<typeof setupApp>>["s"]["finance"]>, id = "chk") {
  await repo.upsertAccount({ id, connectionId: null, provider: "csv", externalId: null, identity: null, name: id, iban: null, currency: "EUR", type: "checking" });
}

describe("the analysis cache", () => {
  it("holds one entry per user and scope over many days", async () => {
    const clock = { now: new Date("2026-10-09T10:00:00Z") };
    const { admin, s, adminId } = await setupApp({}, undefined, { now: () => clock.now });
    await admin.call("POST", "/api/import/csv", { content: csvOf(30), accountName: "Tili" });
    const cache = new AnalysisCache();
    const first = await cache.get(s, adminId, "own");
    expect(await cache.get(s, adminId, "own")).toBe(first);
    for (let day = 1; day <= 14; day++) {
      clock.now = new Date(clock.now.getTime() + 86_400_000);
      const today = await cache.get(s, adminId, "own");
      expect(today).not.toBe(first);
      expect(today.ctx.today).toBe(s.today());
      expect(cache.stats().entries).toBe(1);
    }
    expect(cache.stats().rows).toBe(30);
  });

  it("the household view of a member nobody shares with is the own view, in one entry", async () => {
    const { admin, s, adminId } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content: csvOf(5), accountName: "Tili" });
    const cache = new AnalysisCache();
    expect(await cache.get(s, adminId, "household")).toBe(await cache.get(s, adminId, "own"));
    expect(cache.stats().entries).toBe(1);
  });

  it("stays inside the row budget, dropping the least recently used entry, and keeps the one just asked for", async () => {
    const { admin, member, s, adminId } = await setupApp();
    const eero = await member("eero");
    const liisa = await member("liisa");
    await admin.call("POST", "/api/import/csv", { content: csvOf(40), accountName: "Tili" });
    await eero.call("POST", "/api/import/csv", { content: csvOf(40), accountName: "Tili" });
    await liisa.call("POST", "/api/import/csv", { content: csvOf(40), accountName: "Tili" });
    const cache = new AnalysisCache({ maxRows: 90 });
    const a = await cache.get(s, adminId, "own");
    await cache.get(s, eero.id, "own");
    expect(cache.stats()).toEqual({ entries: 2, rows: 80 });
    await cache.get(s, adminId, "own"); // admin is now the most recent
    await cache.get(s, liisa.id, "own");
    // 120 rows do not fit in 90: eero, the least recently used, went
    await waitFor(async () => cache.stats().rows <= 90);
    expect(cache.stats()).toEqual({ entries: 2, rows: 80 });
    expect(await cache.get(s, adminId, "own")).toBe(a);
    // a single history larger than the budget is still served
    const tiny = new AnalysisCache({ maxRows: 1 });
    expect((await tiny.get(s, adminId, "own")).ctx.txs).toHaveLength(40);
    expect(tiny.stats().entries).toBe(1);
  });

  it("drops entries nobody asked for in an hour", async () => {
    const clock = { ms: 0 };
    const { admin, member, s, adminId } = await setupApp();
    const eero = await member("eero");
    await admin.call("POST", "/api/import/csv", { content: csvOf(3), accountName: "Tili" });
    await eero.call("POST", "/api/import/csv", { content: csvOf(3), accountName: "Tili" });
    const cache = new AnalysisCache({ clock: () => clock.ms });
    await cache.get(s, adminId, "own");
    await cache.get(s, eero.id, "own");
    clock.ms = 61 * 60_000;
    await cache.get(s, adminId, "own");
    expect(cache.stats().entries).toBe(1);
  });
});

describe("per-user data versions", () => {
  it("one member's change leaves the others' cached analyses alone", async () => {
    const { admin, member, s, adminId } = await setupApp();
    const eero = await member("eero");
    await admin.call("POST", "/api/import/csv", { content: csvOf(10), accountName: "Tili" });
    await eero.call("POST", "/api/import/csv", { content: csvOf(10, "TOINEN"), accountName: "Tili" });
    const mine = await s.analysis.get(s, adminId, "own");
    const theirs = await s.analysis.get(s, eero.id, "own");
    const row = (await eero.call("GET", "/api/transactions?limit=1")).body.items[0];
    await eero.call("PATCH", `/api/transactions/${row.id}`, { category: "restaurants" });
    expect(await s.analysis.get(s, adminId, "own")).toBe(mine);
    expect(await s.analysis.get(s, eero.id, "own")).not.toBe(theirs);
  });

  it("a shared account's owner counts for the members who see it, and for no one else", async () => {
    const { admin, member, s, adminId } = await setupApp();
    const eero = await member("eero");
    const liisa = await member("liisa");
    await admin.call("POST", "/api/import/csv", { content: csvOf(10), accountName: "Tili" });
    await eero.call("POST", "/api/import/csv", { content: csvOf(5, "TOINEN"), accountName: "Eeron tili" });
    const accountId = (await admin.call("GET", "/api/meta")).body.accounts[0].id;
    expect((await admin.call("PUT", `/api/accounts/${accountId}/shares/${eero.id}`)).status).toBe(200);

    const eeroHousehold = await s.analysis.get(s, eero.id, "household");
    expect(eeroHousehold.ctx.txs).toHaveLength(15);
    const eeroOwn = await s.analysis.get(s, eero.id, "own");
    const liisaOwn = await s.analysis.get(s, liisa.id, "own");

    // the owner imports more: the member who sees the account gets the new rows, the others keep their entries
    await admin.call("POST", "/api/import/csv", { content: csvOf(4, "UUSI"), accountId });
    const after = await s.analysis.get(s, eero.id, "household");
    expect(after).not.toBe(eeroHousehold);
    expect(after.ctx.txs).toHaveLength(19);
    expect(await s.analysis.get(s, eero.id, "own")).toBe(eeroOwn);
    expect(await s.analysis.get(s, liisa.id, "own")).toBe(liisaOwn);

    // ending the share changes the view at once
    await admin.call("DELETE", `/api/accounts/${accountId}/shares/${eero.id}`);
    expect((await s.analysis.get(s, eero.id, "household")).ctx.txs).toHaveLength(5);
  });

  it("removing a member drops everyone's cached view of them", async () => {
    const { admin, member, s, adminId } = await setupApp();
    const eero = await member("eero");
    await admin.call("POST", "/api/import/csv", { content: csvOf(6), accountName: "Tili" });
    await eero.call("POST", "/api/import/csv", { content: csvOf(3, "TOINEN"), accountName: "Tili" });
    const accountId = (await eero.call("GET", "/api/meta")).body.accounts[0].id;
    await eero.call("PUT", `/api/accounts/${accountId}/shares/${adminId}`);
    expect((await s.analysis.get(s, adminId, "household")).ctx.txs).toHaveLength(9);
    expect((await admin.call("DELETE", `/api/users/${eero.id}`, { password: "aino-salasana-123" })).status).toBe(200);
    expect((await s.analysis.get(s, adminId, "household")).ctx.txs).toHaveLength(6);
  });
});

describe("a sync or an import that changed nothing", () => {
  it("the same CSV again writes nothing, marks nothing and keeps the version", async () => {
    const { admin, s, adminId } = await setupApp();
    const first = await admin.call("POST", "/api/import/csv", { content: csvOf(20), accountName: "Tili" });
    expect(first.body).toMatchObject({ inserted: 20 });
    const accountId = first.body.accountId;
    const version = await s.settings.dataVersionOf([adminId]);
    const entry = await s.analysis.get(s, adminId, "own");
    const again = await admin.call("POST", "/api/import/csv", { content: csvOf(20), accountId });
    expect(again.body).toMatchObject({ inserted: 0, updated: 20, changed: 0 });
    expect(await s.settings.dataVersionOf([adminId])).toBe(version);
    expect(await s.finance(adminId).unprocessedMark()).toBeNull();
    expect(await s.analysis.get(s, adminId, "own")).toBe(entry);
    // one new row is a change
    const more = await admin.call("POST", "/api/import/csv", { content: csvOf(21), accountId });
    expect(more.body).toMatchObject({ inserted: 1, changed: 1 });
    expect(await s.settings.dataVersionOf([adminId])).not.toBe(version);
  });

  it("a row sent again with the same bank fields is not written, a changed field is, a new raw payload alone is not", async () => {
    const { s, adminId } = await setupApp();
    const repo = s.finance(adminId);
    await account(repo);
    const rows = [raw("2026-10-01", -42, "K-MARKET", { externalId: "x1", raw: { v: 1 } }), raw("2026-10-02", 2500, "TYÖNANTAJA OY", { externalId: "x2", raw: { v: 1 } })];
    expect(await ingestTransactions(repo, "chk", rows, "enablebanking", { replacePending: true })).toMatchObject({ inserted: 2, changed: 2 });
    await s.settings.set("probe", "1");
    await repo.clearUnprocessedMark(await repo.unprocessedMark());
    const version = await s.settings.dataVersionOf([adminId]);

    const same = await ingestTransactions(repo, "chk", rows, "enablebanking", { replacePending: true });
    expect(same).toMatchObject({ inserted: 0, updated: 2, changed: 0 });
    const rawOnly = await ingestTransactions(repo, "chk", [{ ...rows[0]!, raw: { v: 2, extra: true } }, rows[1]!], "enablebanking", { replacePending: true });
    expect(rawOnly.changed).toBe(0);
    expect(await s.settings.dataVersionOf([adminId])).toBe(version);
    expect(await repo.unprocessedMark()).toBeNull();

    const edited = await ingestTransactions(repo, "chk", [{ ...rows[0]!, description: "korjattu viesti" }, rows[1]!], "enablebanking", { replacePending: true });
    expect(edited).toMatchObject({ updated: 2, changed: 1 });
    expect(await repo.unprocessedMark()).not.toBeNull();
    expect(await s.settings.dataVersionOf([adminId])).not.toBe(version);
    expect((await repo.getTransaction((await repo.allTransactions()).find((t) => t.counterparty === "K-MARKET")!.id))?.description).toBe("korjattu viesti");
  });

  it("pending rows are replaced only when they differ, and a booked row replacing one counts", async () => {
    const { s, adminId } = await setupApp();
    const repo = s.finance(adminId);
    await account(repo);
    const pending = [raw("2026-10-08", -3.2, "KAHVILA ESPRESSO", { status: "pending", externalId: null })];
    expect(await ingestTransactions(repo, "chk", pending, "enablebanking", { replacePending: true })).toMatchObject({ changed: 1 });
    await repo.clearUnprocessedMark(await repo.unprocessedMark());
    expect(await ingestTransactions(repo, "chk", pending, "enablebanking", { replacePending: true })).toMatchObject({ changed: 0 });
    expect(await repo.unprocessedMark()).toBeNull();
    // the amount changed at the bank
    expect((await ingestTransactions(repo, "chk", [{ ...pending[0]!, amountCents: -350 }], "enablebanking", { replacePending: true })).changed).toBeGreaterThan(0);
    // the pending row is gone and a booked one came
    const booked = await ingestTransactions(repo, "chk", [raw("2026-10-08", -3.5, "KAHVILA ESPRESSO")], "enablebanking", { replacePending: true });
    expect(booked.changed).toBeGreaterThan(0);
    expect((await repo.allTransactions()).map((t) => t.status)).toEqual(["booked"]);
  });

  it("a scheduled fetch that finds nothing new does not touch the version, a moved balance does", async () => {
    const bank = mockBank();
    const { admin, s, adminId } = await setupApp({}, bank.fetchMock);
    expect((await admin.call("PUT", "/api/bank/credentials", { appId: randomUUID(), privateKeyPem: pem })).status).toBe(200);
    await admin.call("POST", "/api/connections/start", {});
    await admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.some((r: { status: string }) => r.status !== "running"));
    await admin.call("POST", "/api/sync");
    const version = await s.settings.dataVersionOf([adminId]);
    const entry = await s.analysis.get(s, adminId, "own");

    const again = await admin.call("POST", "/api/sync");
    expect(again.body).toMatchObject({ status: "ok", inserted: 0 });
    expect(await s.settings.dataVersionOf([adminId])).toBe(version);
    expect(await s.analysis.get(s, adminId, "own")).toBe(entry);

    // the balance is part of the cached view: a changed one drops it, without processing the history
    const account = (await s.finance(adminId).listAccounts()).find((a) => a.balanceCents !== null)!;
    await s.finance(adminId).setAccountBalance(account.id, (account.balanceCents ?? 0) + 100, "2026-10-09T09:00:00Z");
    await admin.call("POST", "/api/sync");
    expect(await s.settings.dataVersionOf([adminId])).not.toBe(version);
    expect(await s.finance(adminId).unprocessedMark()).toBeNull();
  });
});
