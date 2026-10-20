/**
 * What each bank supports, kept in the settings (capabilities.ts): the facts of the bank list, the facts a link or a
 * fetch sees, and the admin route that shows them. Names and sums are made up.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { offeredBanks } from "../src/connectors/enable-banking/app-setup.ts";
import { noteSeen } from "../src/connectors/enable-banking/capabilities.ts";
import { psuHeaders } from "../src/connectors/enable-banking/psu.ts";
import { setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CAPABILITIES = "instance_bank_capabilities";
const ROUTE = "/api/admin/bank-app/capabilities";

afterEach(() => vi.restoreAllMocks());

async function rig() {
  const bank = mockBank();
  const t = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
  const records = async () => (await t.admin.call("GET", ROUTE)).body.banks as { bankId: string; [k: string]: unknown }[];
  const idle = () => waitFor(async () => (await t.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  /** Links the mock bank's two accounts (a current account and a card); the fetch that follows is waited for. */
  const link = async () => {
    await t.admin.call("POST", "/api/connections/start", {});
    expect((await t.admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` })).status).toBe(200);
    await idle();
  };
  return { ...t, bank, records, link, idle };
}

const aspsp = (name: string, extra: object = {}) => ({ name, country: "FI", maximum_consent_validity: 90 * 86400, psu_types: ["personal"], ...extra });
const row = (date: string) => ({ entry_reference: `r-${date}`, transaction_amount: { currency: "EUR", amount: "5.00" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: date, remittance_information: ["KAUPPA A"] });

describe("the bank list", () => {
  it("keeps the bank's own PSU headers, and null for a bank whose entry has none", async () => {
    const { s, bank, records } = await rig();
    bank.answers["GET /aspsps"] = {
      status: 200,
      body: { aspsps: [aspsp("Nordea", { required_psu_headers: ["Psu-Ip-Address", "Psu-User-Agent", "Psu-Accept"], maximum_consent_validity: 180 * 86400 }), aspsp("OP")] },
    };
    await offeredBanks(s);
    expect(await records()).toEqual([
      expect.objectContaining({ bankId: "nordea-fi", consentDays: 180, requiredPsuHeaders: ["Psu-Ip-Address", "Psu-User-Agent", "Psu-Accept"], psuTypes: ["personal"], cardAccounts: false, pending: false, balanceTypes: [], historyDays: null }),
      expect.objectContaining({ bankId: "op-fi", consentDays: 90, requiredPsuHeaders: null }),
    ]);
  });

  it("drops what is no header or no length, and keeps a record when a later list lacks the bank", async () => {
    const { s, bank, records } = await rig();
    bank.answers["GET /aspsps"] = { status: 200, body: { aspsps: [aspsp("Nordea", { required_psu_headers: ["Psu-Accept", "X-Evil\r\nA: b", 5], maximum_consent_validity: 5 })] } };
    await offeredBanks(s);
    expect(await records()).toEqual([expect.objectContaining({ bankId: "nordea-fi", consentDays: null, requiredPsuHeaders: ["Psu-Accept"] })]);
    bank.answers["GET /aspsps"] = { status: 200, body: { aspsps: [aspsp("OP")] } };
    // past the day the first list is kept for
    const later = new Date(s.now().getTime() + 2 * 86_400_000);
    vi.spyOn(s, "now").mockReturnValue(later);
    await offeredBanks(s);
    expect((await records()).map((r) => r.bankId)).toEqual(["nordea-fi", "op-fi"]);
  });

  it("is what psuHeaders uses: the bank's list when it has one, the default pair when it does not", () => {
    const header = (name: string) => ({ "user-agent": "Selain/1.0", accept: "text/html" })[name];
    expect(Object.keys(psuHeaders("203.0.113.9", header, ["Psu-Ip-Address", "Psu-Accept"])!)).toEqual(["Psu-Ip-Address", "Psu-Accept"]);
    expect(Object.keys(psuHeaders("203.0.113.9", header, null)!)).toEqual(["Psu-Ip-Address", "Psu-User-Agent"]);
    expect(Object.keys(psuHeaders("203.0.113.9", header)!)).toEqual(["Psu-Ip-Address", "Psu-User-Agent"]);
    // all or none: a required header the browser did not send, or an address that is not public
    expect(psuHeaders("203.0.113.9", header, ["Psu-Ip-Address", "Psu-Accept-Language"])).toBeNull();
    expect(psuHeaders("192.168.1.4", header, ["Psu-Ip-Address", "Psu-Accept"])).toBeNull();
  });
});

describe("what a link and a fetch see", () => {
  it("adds the card, the pending row, the balance type and the history depth of the bank", async () => {
    const { link, records } = await rig();
    expect(await records()).toEqual([]);
    await link();
    // the mock card's oldest row is 12.9.: 27 days before 9.10.
    expect(await records()).toEqual([expect.objectContaining({ bankId: "nordea-fi", cardAccounts: true, pending: true, balanceTypes: ["CLBD"], historyDays: 27 })]);
  });

  it("shows no pending row when the fetch had only booked ones", async () => {
    const { bank, records, link } = await rig();
    bank.answers["GET /accounts/u-chk/transactions"] = { status: 200, body: { transactions: [row("2026-10-01")] } };
    bank.answers["GET /accounts/u-card/transactions"] = { status: 200, body: { transactions: [row("2026-10-05")] } };
    await link();
    expect(await records()).toEqual([expect.objectContaining({ cardAccounts: true, pending: false, historyDays: 8 })]);
  });

  it("only lets the history grow, and keeps a card or a pending row once seen", async () => {
    const { bank, admin, link, records } = await rig();
    await link();
    // a fetch that reaches back less far
    bank.answers["GET /accounts/u-card/transactions"] = { status: 200, body: { transactions: [row("2026-10-05")] } };
    await admin.call("POST", "/api/sync");
    expect(await records()).toEqual([expect.objectContaining({ cardAccounts: true, pending: true, historyDays: 27 })]);
    // a deeper one: 1.8. is 69 days before 9.10.
    bank.answers["GET /accounts/u-card/transactions"] = { status: 200, body: { transactions: [row("2026-08-01")] } };
    await admin.call("POST", "/api/sync");
    expect(await records()).toEqual([expect.objectContaining({ historyDays: 69 })]);
  });

  it("keeps two banks apart, and keeps nothing for a bank outside the list", async () => {
    const { s, link, records } = await rig();
    await link();
    await noteSeen(s, "op-fi", { pending: true, balanceTypes: ["ITAV", "clbd", "nope", 7], historyDays: 400 });
    await noteSeen(s, "unknown-fi", { pending: true });
    await noteSeen(s, null, { pending: true });
    const [nordea, op, ...rest] = await records();
    expect(rest).toEqual([]);
    expect(nordea).toMatchObject({ bankId: "nordea-fi", cardAccounts: true, balanceTypes: ["CLBD"], historyDays: 27 });
    expect(op).toMatchObject({ bankId: "op-fi", cardAccounts: false, pending: true, balanceTypes: ["ITAV"], historyDays: 400 });
  });

  it("keeps no account id, no name and no date", async () => {
    const { link, admin } = await rig();
    await link();
    const text = JSON.stringify((await admin.call("GET", ROUTE)).body);
    expect(text).not.toMatch(/u-chk|u-card|h-chk|FI21|Testi|Esimerkki|20\d\d-\d\d-\d\d/);
  });

  it("a write that fails leaves the link and the fetch green", async () => {
    const { s, admin, bank, idle, records } = await rig();
    const set = s.settings.set.bind(s.settings);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(s.settings, "set").mockImplementation(async (key: string, value: string) => {
      if (key === CAPABILITIES) throw new Error("disk full");
      return set(key, value);
    });
    await admin.call("POST", "/api/connections/start", {});
    expect((await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` })).status).toBe(200);
    await idle();
    const runs = (await admin.call("GET", "/api/sync/runs")).body.runs as { status: string }[];
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.status === "ok")).toBe(true);
    expect(await records()).toEqual([]);
  });
});

describe("the route", () => {
  it("is for an admin: a member gets 403", async () => {
    const { member, admin } = await rig();
    const eero = await member("eero");
    expect((await eero.call("GET", ROUTE)).status).toBe(403);
    expect((await admin.call("GET", ROUTE)).status).toBe(200);
  });
});
