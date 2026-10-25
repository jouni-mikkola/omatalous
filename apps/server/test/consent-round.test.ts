import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { mockBank } from "./mock-bank.ts";
import { NOW, setupApp, waitFor } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

// Renewing every consent in one round: the server picks the banks that are due, keeps the round, and reads what is done
// from the consents. The bank answers for Nordea and OP; each consent's end date is the one the session gives.
type Admin = Awaited<ReturnType<typeof setupApp>>["admin"];
type Bank = ReturnType<typeof mockBank>;

const NORDEA_SAVINGS = { uid: "u-sav", identification_hash: "h-sav", account_id: { iban: "FI1410093000123458" }, name: "Säästötili", currency: "EUR", cash_account_type: "CACC" };
const OP_ACCOUNT = { uid: "u-op", identification_hash: "h-op", account_id: { iban: "FI4950009420028730" }, name: "Testi Esimerkki", product: "Käyttötili", currency: "EUR", cash_account_type: "CACC" };

function setup() {
  const bank = mockBank();
  bank.answers["GET /aspsps"] = { status: 200, body: { aspsps: [{ name: "Nordea", country: "FI", maximum_consent_validity: 180 * 86400 }, { name: "OP", country: "FI", maximum_consent_validity: 180 * 86400 }] } };
  bank.answers["GET /accounts/u-sav/details"] = { status: 200, body: NORDEA_SAVINGS };
  bank.answers["GET /accounts/u-sav/transactions"] = { status: 200, body: { transactions: [] } };
  bank.answers["GET /accounts/u-sav/balances"] = { status: 200, body: { balances: [{ balance_amount: { currency: "EUR", amount: "20.00" }, balance_type: "CLBD" }] } };
  bank.answers["GET /accounts/u-op/details"] = { status: 200, body: OP_ACCOUNT };
  bank.answers["GET /accounts/u-op/transactions"] = { status: 200, body: { transactions: [] } };
  bank.answers["GET /accounts/u-op/balances"] = { status: 200, body: { balances: [{ balance_amount: { currency: "EUR", amount: "10.00" }, balance_type: "CLBD" }] } };
  return { bank, ready: setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock) };
}

/**
 * Links a bank whose consent ends on `validUntil`. A consent made later by the same bank takes over the accounts it brings
 * again; `savings` makes it the Nordea consent that brings the savings account instead of the checking account.
 */
async function link(admin: Admin, bank: Bank, which: "nordea-fi" | "op-fi", validUntil: string, savings = false, id = `sess-${randomUUID()}`): Promise<string> {
  const nordea = which === "nordea-fi";
  bank.answers["POST /sessions"] = {
    status: 200,
    body: { session_id: id, aspsp: { name: nordea ? "Nordea" : "OP", country: "FI" }, access: { valid_until: validUntil }, accounts: nordea && savings ? [NORDEA_SAVINGS] : nordea ? [{ uid: "u-chk", identification_hash: "h-chk", account_id: { iban: "FI2112345600000785" }, name: "Käyttötili", currency: "EUR", cash_account_type: "CACC" }] : [OP_ACCOUNT] },
  };
  expect((await admin.call("POST", "/api/connections/start", { bank: which })).status).toBe(200);
  expect((await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` })).status).toBe(200);
  await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  return id;
}

/** The id of the only consent of `institution` that is on the list. */
const consentOf = async (admin: Admin, institution: string): Promise<string> =>
  (await admin.call("GET", "/api/meta")).body.connections.find((c: { institution: string; history: boolean }) => c.institution === institution && !c.history).id;
const renewal = async (admin: Admin) => (await admin.call("GET", "/api/meta")).body.renewal;

describe("a round of consents", () => {
  // the tests move the shared clock on to let a consent be made after the round began
  const start = NOW.getTime();
  afterEach(() => NOW.setTime(start));

  it("renews two banks whose consents end, one consent at a time, and reads what is left from the consents", async () => {
    const { bank, ready } = setup();
    const { admin, s, adminId } = await ready;
    // Nordea ends in 11 days, OP ended on the 1st (NOW is 2026-10-09)
    await link(admin, bank, "nordea-fi", "2026-10-20T00:00:00Z");
    await link(admin, bank, "op-fi", "2026-10-01T00:00:00Z");
    const [nordea, op] = [await consentOf(admin, "Nordea"), await consentOf(admin, "OP")];
    expect(await renewal(admin)).toEqual({ due: [{ connection: op, bank: "op-fi" }, { connection: nordea, bank: "nordea-fi" }], round: null });

    const started = await admin.call("POST", "/api/connections/round");
    expect(started.status).toBe(200);
    expect(started.body).toEqual({ consents: [{ connection: op, bank: "op-fi", done: false }, { connection: nordea, bank: "nordea-fi", done: false }], finished: false });
    expect(JSON.parse((await s.settings.get(`consent_round:${adminId}`))!)).toMatchObject({ consents: [{ connection: op, bank: "op-fi" }, { connection: nordea, bank: "nordea-fi" }] });

    // the browser renews the first bank through the usual route; the second is still left
    NOW.setTime(NOW.getTime() + 60_000);
    await link(admin, bank, "op-fi", "2027-04-06T00:00:00Z");
    expect(await renewal(admin)).toEqual({
      due: [{ connection: nordea, bank: "nordea-fi" }],
      round: { consents: [{ connection: op, bank: "op-fi", done: true }, { connection: nordea, bank: "nordea-fi", done: false }], finished: false },
    });

    NOW.setTime(NOW.getTime() + 60_000);
    await link(admin, bank, "nordea-fi", "2027-04-06T00:00:00Z");
    expect(await renewal(admin)).toEqual({
      due: [],
      round: { consents: [{ connection: op, bank: "op-fi", done: true }, { connection: nordea, bank: "nordea-fi", done: true }], finished: true },
    });

    expect((await admin.call("DELETE", "/api/connections/round")).status).toBe(200);
    expect(await renewal(admin)).toEqual({ due: [], round: null });
    expect(await s.settings.get(`consent_round:${adminId}`)).toBeNull();
  });

  it("does not finish while another consent of a renewed bank is still due: Nordea gives one account per consent", async () => {
    const { bank, ready } = setup();
    const { admin } = await ready;
    // two Nordea consents with an account each, and OP, all ending in 6 days
    await link(admin, bank, "nordea-fi", "2026-10-15T00:00:00Z");
    await link(admin, bank, "nordea-fi", "2026-10-15T00:00:00Z", true);
    await link(admin, bank, "op-fi", "2026-10-15T00:00:00Z");
    const due = (await renewal(admin)).due;
    expect(due.map((c: { bank: string }) => c.bank).sort()).toEqual(["nordea-fi", "nordea-fi", "op-fi"]);
    const started = await admin.call("POST", "/api/connections/round");
    expect(started.body.consents).toHaveLength(3);

    NOW.setTime(NOW.getTime() + 60_000);
    await link(admin, bank, "op-fi", "2027-04-06T00:00:00Z");
    await link(admin, bank, "nordea-fi", "2027-04-06T00:00:00Z");
    const half = (await renewal(admin)).round;
    expect(half.finished).toBe(false);
    expect(half.consents.filter((c: { done: boolean }) => c.done)).toHaveLength(2);
    expect((await renewal(admin)).due).toHaveLength(1);

    // the other Nordea consent is renewed with its own account, and now the round is finished
    NOW.setTime(NOW.getTime() + 60_000);
    await link(admin, bank, "nordea-fi", "2027-04-06T00:00:00Z", true);
    const done = await renewal(admin);
    expect(done.due).toEqual([]);
    expect(done.round.finished).toBe(true);
  });

  it("starts nothing when no bank is due, and takes no parameter from the browser", async () => {
    const { bank, ready } = setup();
    const { admin } = await ready;
    await link(admin, bank, "nordea-fi", "2027-04-06T00:00:00Z");
    const none = await admin.call("POST", "/api/connections/round");
    expect(none.status).toBe(400);
    expect(none.body.error).toBe("Ei yhteyksiä, jotka pitäisi uusia.");
    expect((await renewal(admin)).round).toBeNull();

    await link(admin, bank, "op-fi", "2026-10-15T00:00:00Z");
    // a bank named in the body is ignored: the server decides from the consents
    const started = await admin.call("POST", "/api/connections/round", { banks: ["danske-fi", "nordea-fi"] });
    expect(started.body.consents).toEqual([{ connection: await consentOf(admin, "OP"), bank: "op-fi", done: false }]);
  });

  it("is each user's own, and a round older than a week is dropped", async () => {
    const { bank, ready } = setup();
    const { admin, s, adminId } = await ready;
    await link(admin, bank, "op-fi", "2026-10-01T00:00:00Z");
    await admin.call("POST", "/api/connections/round");
    expect((await renewal(admin)).round).not.toBeNull();

    const stored = JSON.parse((await s.settings.get(`consent_round:${adminId}`))!);
    await s.settings.set(`consent_round:${adminId}`, JSON.stringify({ ...stored, startedAt: new Date(NOW.getTime() - 8 * 86_400_000).toISOString() }));
    expect((await renewal(admin)).round).toBeNull();
  });
});
