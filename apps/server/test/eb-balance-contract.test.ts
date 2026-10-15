/**
 * What a balance carries from the bank into the app: the amount with its type, its reference day and its currency
 * (the contract of `Puller.balance`), a balance stored only in the account's own currency, and a day walk that starts
 * from the day the bank says the balance stands for. Names and sums are made up.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { balanceFitsAccount, balanceStamp, isCurrencyCode, isEuro } from "../src/connectors/balance-sign.ts";
import { balanceReading, pickBalance } from "../src/connectors/enable-banking/mapper.ts";
import type { EbBalance } from "../src/connectors/enable-banking/types.ts";
import { NOW, setupApp, waitFor } from "./helpers.ts";
import { HOLDER, HOLDER_IBAN, mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const bal = (amount: string, type: string, reference_date?: string | null, currency = "EUR"): EbBalance => ({ balance_amount: { currency, amount }, balance_type: type, ...(reference_date === undefined ? {} : { reference_date }) });

describe("balanceReading", () => {
  it("keeps the amount, the bank's code, the reference day and the currency", () => {
    expect(balanceReading(bal("1000.00", "CLBD", "2026-10-07"))).toEqual({ cents: 100_000, type: "CLBD", referenceDay: "2026-10-07", currency: "EUR" });
    expect(balanceReading(bal("-12.50", "ITBD", "2026-10-08", "usd"))).toEqual({ cents: -1_250, type: "ITBD", referenceDay: "2026-10-08", currency: "USD" });
  });

  it("leaves the reference day null when the bank sends none or sends no date, and never guesses one", () => {
    expect(balanceReading(bal("1.00", "CLBD"))?.referenceDay).toBeNull();
    expect(balanceReading(bal("1.00", "CLBD", null))?.referenceDay).toBeNull();
    expect(balanceReading(bal("1.00", "CLBD", ""))?.referenceDay).toBeNull();
    expect(balanceReading(bal("1.00", "CLBD", "yesterday"))?.referenceDay).toBeNull();
    expect(balanceReading(bal("1.00", "CLBD", "2026-02-30"))?.referenceDay).toBeNull();
    // a bank that sends a time gives its day
    expect(balanceReading(bal("1.00", "CLBD", "2026-10-07T00:00:00"))?.referenceDay).toBe("2026-10-07");
  });

  it("leaves a type or a currency the bank does not name null, and gives nothing for an amount that is no number", () => {
    expect(balanceReading({ balance_amount: { currency: "", amount: "5.00" }, balance_type: "" })).toEqual({ cents: 500, type: null, referenceDay: null, currency: null });
    expect(balanceReading(bal("n/a", "CLBD", "2026-10-07"))).toBeNull();
  });

  it("is read from the balance pickBalance picks, whose order is for display only", () => {
    const all = [bal("990.00", "OPBD", "2026-10-07"), bal("1000.00", "ITBD", "2026-10-07"), bal("1010.00", "CLBD", "2026-10-06")];
    expect(balanceReading(pickBalance(all)!)).toMatchObject({ cents: 101_000, type: "CLBD", referenceDay: "2026-10-06" });
    expect(balanceReading(pickBalance([all[0]!, all[1]!])!)).toMatchObject({ cents: 100_000, type: "ITBD" });
    expect(balanceReading(pickBalance([all[0]!])!)).toMatchObject({ cents: 99_000, type: "OPBD" });
  });
});

describe("what a balance stands for", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  it("is the reference day at noon UTC, so that every time zone reads that day", () => {
    expect(balanceStamp({ type: "CLBD", referenceDay: "2026-10-07" }, now, "2026-10-09")).toBe("2026-10-07T12:00:00.000Z");
    expect(balanceStamp({ type: "ITBD", referenceDay: "2026-10-09" }, now, "2026-10-09")).toBe("2026-10-09T12:00:00.000Z");
  });

  it("is the day before for an opening balance, which is the state at the start of its day", () => {
    expect(balanceStamp({ type: "OPBD", referenceDay: "2026-10-07" }, now, "2026-10-09")).toBe("2026-10-06T12:00:00.000Z");
    expect(balanceStamp({ type: "CLBD", referenceDay: "2026-10-07" }, now, "2026-10-09")).toBe("2026-10-07T12:00:00.000Z");
  });

  it("is the moment of the fetch when the bank gave no day or one in the future", () => {
    expect(balanceStamp({ type: "CLBD", referenceDay: null }, now, "2026-10-09")).toBe(now.toISOString());
    expect(balanceStamp({ type: "CLBD", referenceDay: "2026-10-10" }, now, "2026-10-09")).toBe(now.toISOString());
  });

  it("fits an account only in the account's own currency, and never one the bank does not name", () => {
    expect(balanceFitsAccount({ currency: "EUR" }, "EUR")).toBe(true);
    expect(balanceFitsAccount({ currency: "USD" }, "usd")).toBe(true);
    expect(balanceFitsAccount({ currency: "USD" }, "EUR")).toBe(false);
    expect(balanceFitsAccount({ currency: "EUR" }, "USD")).toBe(false);
    expect(balanceFitsAccount({ currency: null }, "EUR")).toBe(false);
    expect(isEuro(" eur ")).toBe(true);
    expect(isEuro("USD")).toBe(false);
    expect(["USD", " sek ", "XXX", "", "EURO", "US"].map(isCurrencyCode)).toEqual([true, true, false, false, false, false]);
  });
});

/** Links a checking account in euros and a dollar account, with the balances and the rows between the days given. */
async function linked(balances: { chk: EbBalance[]; usd: EbBalance[] }) {
  const bank = mockBank();
  const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
  const chk = { uid: "u-chk", identification_hash: "h-chk", account_id: { iban: HOLDER_IBAN }, name: HOLDER, product: "Käyttötili", currency: "EUR", cash_account_type: "CACC" };
  const usd = { uid: "u-usd", identification_hash: "h-usd", account_id: { iban: "FI9612345600000793" }, name: HOLDER, product: "Dollaritili", currency: "USD", cash_account_type: "CACC" };
  await admin.call("POST", "/api/connections/start", {});
  bank.answers["POST /sessions"] = { status: 200, body: { session_id: "sess-usd", aspsp: { name: "Nordea", country: "FI" }, access: { valid_until: "2027-04-06T00:00:00Z" }, accounts: [chk, usd] } };
  const row = (id: string, amount: string, date: string, text: string) => ({ entry_reference: id, transaction_amount: { currency: "EUR", amount }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: date, remittance_information: [text] });
  // one row on the reference day (the balance holds it) and one on the day between (it does not)
  bank.answers["GET /accounts/u-chk/transactions"] = { status: 200, body: { transactions: [row("r1", "20.00", "2026-10-07", "KAUPPA A"), row("r2", "50.00", "2026-10-08", "KAUPPA B")] } };
  bank.answers["GET /accounts/u-usd/transactions"] = { status: 200, body: { transactions: [] } };
  bank.answers["GET /accounts/u-chk/balances"] = { status: 200, body: { balances: balances.chk } };
  bank.answers["GET /accounts/u-usd/balances"] = { status: 200, body: { balances: balances.usd } };
  expect((await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` })).status).toBe(200);
  await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  const meta = async () => (await admin.call("GET", "/api/meta")).body.accounts as { name: string; currency: string; balanceCents: number | null; balanceAt: string | null }[];
  return { admin, bank, meta };
}

/**
 * Worked example, today 9.10.2026: Käyttötili's bank balance is 1 000,00 € on 7.10. (fetched 9.10.), a row of 20,00 on
 * 7.10. is in it, a row of 50,00 on 8.10. is not. The dollar account holds 540,00 USD.
 */
describe("a fetch with a reference day and a dollar account", () => {
  it("stores each balance with the day it stands for and walks from that day: Tilit says 950,00 €, the dollars are beside it and in no total", async () => {
    const { admin, meta } = await linked({ chk: [bal("1000.00", "CLBD", "2026-10-07")], usd: [bal("540.00", "CLBD", "2026-10-07", "USD")] });
    const accounts = await meta();
    expect(accounts.find((a) => a.name === "Käyttötili")).toMatchObject({ balanceCents: 100_000, currency: "EUR", balanceAt: "2026-10-07T12:00:00.000Z" });
    expect(accounts.find((a) => a.name === "Dollaritili")).toMatchObject({ balanceCents: 54_000, currency: "USD" });

    const dashboard = (await admin.call("GET", "/api/dashboard?scope=own")).body.holdings;
    const row = (name: string) => dashboard.accounts.find((a: { name: string }) => a.name === name);
    // 1 000,00 at the end of 7.10. less the 50,00 of 8.10.; the old walk took both rows off a balance it took for the 9th
    expect(row("Käyttötili")).toMatchObject({ balanceCents: 95_000, foreign: null });
    expect(row("Dollaritili")).toMatchObject({ balanceCents: null, foreign: { currency: "USD", cents: 54_000 } });
    expect(dashboard.accountsCents).toBe(95_000);

    // Saldot: the same walk, and no series for the dollar account
    const report = (await admin.call("GET", "/api/reports?reports=balances&scope=own")).body.balances;
    expect(report.holdings).toEqual(dashboard);
    expect(report.accounts.map((a: { name: string }) => a.name)).toEqual(["Käyttötili"]);
    expect(report.total.at(-1)).toBe(95_000);
  });

  it("walks from the fetch day when the bank sends no reference day, as before", async () => {
    const { admin } = await linked({ chk: [bal("1000.00", "CLBD")], usd: [bal("540.00", "CLBD", null, "USD")] });
    const holdings = (await admin.call("GET", "/api/dashboard?scope=own")).body.holdings;
    expect(holdings.accounts.find((a: { name: string }) => a.name === "Käyttötili").balanceCents).toBe(100_000);
    expect(holdings.accountsCents).toBe(100_000);
  });

  it("does not store a balance in another currency than the account's, or one with no currency", async () => {
    const wrong = await linked({ chk: [bal("1000.00", "CLBD", "2026-10-07", "USD")], usd: [bal("540.00", "CLBD", "2026-10-07", "EUR")] });
    expect((await wrong.meta()).map((a) => [a.name, a.balanceCents])).toEqual(expect.arrayContaining([["Käyttötili", null], ["Dollaritili", null]]));
    const holdings = (await wrong.admin.call("GET", "/api/dashboard?scope=own")).body.holdings;
    expect(holdings.accountsCents).toBeNull();
    expect(holdings.accounts.every((a: { foreign: unknown }) => a.foreign === null)).toBe(true);

    const none = await linked({ chk: [{ balance_amount: { amount: "1000.00" } as EbBalance["balance_amount"], balance_type: "CLBD", reference_date: "2026-10-07" }], usd: [bal("540.00", "CLBD", "2026-10-07", "USD")] });
    expect((await none.meta()).find((a) => a.name === "Käyttötili")!.balanceCents).toBeNull();
  });
});

describe("a balance stored before the currency was kept", () => {
  it("is never summed into a total: a dollar account shows its own currency, an account of unknown currency a dash", async () => {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    const add = async (id: string, currency: string, cents: number) => {
      await repo.upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: id, identity: null, name: id, iban: null, currency, type: "checking" });
      await repo.setAccountBalance(id, cents, NOW.toISOString());
    };
    await add("eur", "EUR", 100_000);
    await add("usd", "USD", 54_000);
    await add("unknown", "XXX", 33_300);
    await add("blank", "", 22_200);
    const holdings = (await admin.call("GET", "/api/dashboard?scope=own")).body.holdings;
    const row = (name: string) => holdings.accounts.find((a: { name: string }) => a.name === name);
    expect(row("eur")).toMatchObject({ balanceCents: 100_000, foreign: null });
    expect(row("usd")).toMatchObject({ balanceCents: null, foreign: { currency: "USD", cents: 54_000 } });
    expect(row("unknown")).toMatchObject({ balanceCents: null, foreign: null });
    expect(row("blank")).toMatchObject({ balanceCents: null, foreign: null });
    expect(holdings.accountsCents).toBe(100_000);
  });
});
