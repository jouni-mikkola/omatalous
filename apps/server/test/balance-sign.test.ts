/**
 * The sign of a loan account's balance: a bank tells what is owed with a plus, the app keeps a debt below zero. The
 * fetch stores a loan account's plus as a minus, and the upgrade mends what an earlier version stored. Made-up sums.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { ACCOUNT_TYPES } from "@banking/core";
import { describe, expect, it } from "vitest";
import { cardBalance, storedBalanceCents } from "../src/connectors/balance-sign.ts";
import { accountKey } from "../src/db/household-repo.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { setupApp, waitFor } from "./helpers.ts";
import { HOLDER_IBAN, mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("the balance as it is stored", () => {
  it("turns a loan account's plus into a minus and leaves zero, no balance and a minus as they are", () => {
    expect(storedBalanceCents("loan", 14_912_345)).toBe(-14_912_345);
    expect(storedBalanceCents("loan", -14_912_345)).toBe(-14_912_345);
    expect(storedBalanceCents("loan", 0)).toBe(0);
    expect(storedBalanceCents("loan", null)).toBeNull();
    expect(storedBalanceCents("loan", 1)).toBe(-1);
  });

  it("leaves every other account type as told: a card with a plus is money the bank owes the holder", () => {
    for (const type of ACCOUNT_TYPES.filter((t) => t !== "loan")) {
      expect(storedBalanceCents(type, 14_912_345), type).toBe(14_912_345);
      expect(storedBalanceCents(type, -14_912_345), type).toBe(-14_912_345);
      expect(storedBalanceCents(type, null), type).toBeNull();
    }
  });
});

describe("a fetch of a loan account", () => {
  it("stores the balance the bank tells with a plus as a debt, and leaves a checking account and a card with a plus as told", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const loan = { uid: "u-loan", identification_hash: "h-loan", account_id: { iban: "FI9612345600000793" }, name: "Esimerkki Oy", product: "Asuntolaina", currency: "EUR", cash_account_type: "LOAN" };
    await admin.call("POST", "/api/connections/start", {});
    const session = { status: 200, body: { session_id: "sess-loan", aspsp: { name: "Nordea", country: "FI" }, access: { valid_until: "2027-04-06T00:00:00Z" }, accounts: [{ uid: "u-chk", identification_hash: "h-chk", account_id: { iban: HOLDER_IBAN }, name: "Testi Esimerkki", product: "Käyttötili", currency: "EUR", cash_account_type: "CACC" }, { uid: "u-card", identification_hash: "h-card", account_id: { other: { identification: "5225********1144", scheme_name: "CPAN" } }, name: "Testi Esimerkki", product: "Nordea Gold", currency: "EUR", cash_account_type: "CARD" }, loan] } };
    bank.answers["POST /sessions"] = session;
    bank.answers["GET /accounts/u-loan/transactions"] = { status: 200, body: { transactions: [] } };
    bank.answers["GET /accounts/u-loan/balances"] = { status: 200, body: { balances: [{ balance_amount: { currency: "EUR", amount: "149123.45" }, balance_type: "CLBD" }] } };
    const done = await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` });
    expect(done.status).toBe(200);
    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));

    const listed = (await admin.call("GET", "/api/meta")).body.accounts as { name: string; type: string; balanceCents: number | null }[];
    expect(listed.map((a) => [a.name, a.type, a.balanceCents])).toEqual(expect.arrayContaining([["Asuntolaina", "loan", -14_912_345], ["Käyttötili", "checking", 123_456], ["Nordea Gold", "credit_card", 123_456]]));

    // a second fetch tells the same plus: the stored minus is not turned back or again
    await admin.call("POST", "/api/sync");
    const again = (await admin.call("GET", "/api/meta")).body.accounts as { name: string; balanceCents: number | null }[];
    expect(again.find((a) => a.name === "Asuntolaina")!.balanceCents).toBe(-14_912_345);
  });
});

describe("a fetch of a card", () => {
  const CARD_ACCOUNTS = [
    { uid: "u-chk", identification_hash: "h-chk", account_id: { iban: HOLDER_IBAN }, name: "Testi Esimerkki", product: "Käyttötili", currency: "EUR", cash_account_type: "CACC" },
    { uid: "u-card", identification_hash: "h-card", account_id: { other: { identification: "5225********1144", scheme_name: "CPAN" } }, name: "Testi Esimerkki", product: "Nordea Gold", currency: "EUR", cash_account_type: "CARD" },
  ];
  const balance = (amount: string, type: string, reference_date?: string) => ({ balance_amount: { currency: "EUR", amount }, balance_type: type, ...(reference_date ? { reference_date } : {}) });

  /**
   * Links the card, records its debt on 30.9. as `before` and fetches again with `after` for 6.10. The card's rows
   * between are the payment of 300,00 on 5.10. (mock bank). Returns the card's stored balance.
   */
  async function fetchCard(before: number | null, after: object[]) {
    const bank = mockBank();
    const { admin, s, adminId } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await admin.call("POST", "/api/connections/start", {});
    bank.answers["POST /sessions"] = { status: 200, body: { session_id: "sess-card", aspsp: { name: "Nordea", country: "FI" }, access: { valid_until: "2027-04-06T00:00:00Z" }, accounts: CARD_ACCOUNTS } };
    bank.answers["GET /accounts/u-card/balances"] = { status: 200, body: { balances: after } };
    expect((await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` })).status).toBe(200);
    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
    const repo = s.finance(adminId);
    const card = (await repo.listAccounts()).find((a) => a.type === "credit_card")!;
    if (before !== null) {
      await repo.recordBalances(accountKey(card), "2026-10-01", "2026-10-01T06:00:00.000Z", [{ cents: before, type: "CLBD", referenceDay: "2026-09-30" }]);
      await admin.call("POST", "/api/sync");
    }
    return (await repo.listAccounts()).find((a) => a.type === "credit_card")!.balanceCents;
  }

  it("keeps a debt the bank tells below zero as told", async () => {
    expect(await fetchCard(-50_000, [balance("-200.00", "CLBD", "2026-10-06")])).toBe(-20_000);
  });

  it("turns a debt the bank tells as a plus once its first interval adds up only turned", async () => {
    expect(await fetchCard(50_000, [balance("200.00", "CLBD", "2026-10-06")])).toBe(-20_000);
  });

  it("stores no debt read from available credit", async () => {
    expect(await fetchCard(null, [balance("2800.00", "CLAV"), balance("2800.00", "ITAV"), balance("2900.00", "XPCD")])).toBeNull();
    expect(cardBalance([{ type: "CLAV" }, { type: "xpcd" }, { type: "OPBD" }])).toEqual({ type: "OPBD" });
  });

  it("clears a debt an earlier version read from available credit and moves the user's data version", async () => {
    const bank = mockBank();
    const { admin, s, adminId } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await admin.call("POST", "/api/connections/start", {});
    bank.answers["POST /sessions"] = { status: 200, body: { session_id: "sess-card", aspsp: { name: "Nordea", country: "FI" }, access: { valid_until: "2027-04-06T00:00:00Z" }, accounts: CARD_ACCOUNTS } };
    bank.answers["GET /accounts/u-card/balances"] = { status: 200, body: { balances: [balance("2800.00", "CLAV")] } };
    expect((await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` })).status).toBe(200);
    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
    const repo = s.finance(adminId);
    const card = async () => (await repo.listAccounts()).find((a) => a.type === "credit_card")!;
    // what 0.64 stored from the CLAV
    await repo.setAccountBalance((await card()).id, 280_000, "2026-10-01T08:00:00.000Z");
    const version = await s.settings.get(`data_version:${adminId}`);
    await admin.call("POST", "/api/sync");
    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
    expect(await card()).toMatchObject({ balanceCents: null, balanceAt: null });
    expect(await s.settings.get(`data_version:${adminId}`)).not.toBe(version);
  });
});

describe("the upgrade of loan balances stored with a plus", () => {
  it("turns each into a minus once, leaves the rest, and a second run changes nothing", async () => {
    const { s, adminId } = await setupApp();
    const repo = s.finance(adminId);
    const add = async (id: string, type: "loan" | "checking" | "credit_card", cents: number | null) => {
      await repo.upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: id, identity: null, name: id, iban: null, currency: "EUR", type });
      if (cents !== null) await repo.setAccountBalance(id, cents, "2026-10-01T08:00:00.000Z");
    };
    await add("loan-plus", "loan", 14_912_345);
    await add("loan-minus", "loan", -8_000_000);
    await add("loan-zero", "loan", 0);
    await add("loan-none", "loan", null);
    await add("chk", "checking", 200_000);
    await add("card", "credit_card", 50_000);
    const read = async () => Object.fromEntries((await repo.listAccounts()).map((a) => [a.id, a.balanceCents]));
    const untouched = { "loan-minus": -8_000_000, "loan-zero": 0, "loan-none": null, chk: 200_000, card: 50_000 };

    expect(await runUpgradeTasks(s, "0.9.0+loans")).toMatchObject({ users: 1, loanBalances: 1 });
    expect(await read()).toEqual({ ...untouched, "loan-plus": -14_912_345 });
    // every run looks again, and finds nothing above zero
    expect(await runUpgradeTasks(s, "0.9.1+loans")).toMatchObject({ users: 1, loanBalances: 0 });
    expect(await read()).toEqual({ ...untouched, "loan-plus": -14_912_345 });
  });
});
