/**
 * An account's type follows what the bank says of it (migration 0023): every link and the first fetch after the upgrade
 * work it out again, unless the user chose it in Asetukset > Tilit. Made-up holders and accounts.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { HOLDER_IBAN, mockBank } from "./mock-bank.ts";
import { setupApp, waitFor } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const JOINT_IBAN = "FI9612345600000793";
const HOLDERS = "Ricardo Laine;Sloane Virta";

type App = Awaited<ReturnType<typeof setupApp>>;
type Bank = ReturnType<typeof mockBank>;
type Listed = { id: string; iban: string | null; type: string; typeSource: string; bankTypeCode: string | null; bankProduct: string | null };

const session = (accounts: unknown[], id: string) => ({
  status: 200,
  body: { session_id: id, aspsp: { name: "Nordea", country: "FI" }, access: { valid_until: "2027-04-06T00:00:00Z" }, accounts },
});
const checking = { uid: "u-chk", identification_hash: "h-chk", account_id: { iban: HOLDER_IBAN }, name: HOLDERS, product: "Käyttötili", currency: "EUR", cash_account_type: "CACC" };
const joint = (code?: string) => ({ uid: "u-joint", identification_hash: "h-joint", account_id: { iban: JOINT_IBAN }, name: HOLDERS, product: "Käyttötili", currency: "EUR", ...(code ? { cash_account_type: code } : {}) });
const booked = (id: string, euros: string, dir: "CRDT" | "DBIT", extra: object) => ({
  entry_reference: id,
  transaction_amount: { currency: "EUR", amount: euros },
  credit_debit_indicator: dir,
  status: "BOOK",
  booking_date: "2026-10-05",
  remittance_information: ["Oma siirto"],
  ...extra,
});

async function connect(app: App, bank: Bank): Promise<void> {
  await app.admin.call("POST", "/api/connections/start", {});
  expect((await app.admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` })).status).toBe(200);
  await waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
}
const accounts = async (app: App) => (await app.admin.call("GET", "/api/meta")).body.accounts as Listed[];
const jointOf = async (app: App) => (await accounts(app)).find((a) => a.iban === JOINT_IBAN)!;

async function setup() {
  const bank = mockBank();
  const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
  // 400 € from the checking account to the joint one, and its leg on the joint account
  bank.answers["GET /accounts/u-chk/transactions"] = { status: 200, body: { transactions: [booked("t-out", "400.00", "DBIT", { creditor: { name: "Sloane Virta" }, creditor_account: { iban: JOINT_IBAN } })] } };
  bank.answers["GET /accounts/u-joint/transactions"] = { status: 200, body: { transactions: [booked("t-in", "400.00", "CRDT", { debtor: { name: "Ricardo Laine" }, debtor_account: { iban: HOLDER_IBAN } })] } };
  bank.answers["GET /accounts/u-joint/balances"] = { status: 200, body: { balances: [{ balance_amount: { currency: "EUR", amount: "0.45" }, balance_type: "ITBD" }] } };
  return { bank, app };
}

describe("an account's type", () => {
  it("is worked out again at each link from the bank's code, and the type the user chose stays", async () => {
    const { bank, app } = await setup();
    bank.answers["POST /sessions"] = session([checking, joint("OTHR")], "sess-one");
    await connect(app, bank);
    // no code to go by, and the holders' names ("Sloane", "Ricardo") are never read: an account with an IBAN
    expect(await jointOf(app)).toMatchObject({ type: "checking", typeSource: "bank", bankTypeCode: "OTHR", bankProduct: "Käyttötili" });

    bank.answers["POST /sessions"] = session([checking, joint("LOAN")], "sess-two");
    await connect(app, bank);
    expect(await jointOf(app)).toMatchObject({ type: "loan", typeSource: "bank", bankTypeCode: "LOAN" });

    await app.admin.call("PATCH", `/api/accounts/${(await jointOf(app)).id}`, { type: "checking" });
    expect(await jointOf(app)).toMatchObject({ type: "checking", typeSource: "user" });
    bank.answers["POST /sessions"] = session([checking, joint("LOAN")], "sess-three");
    await connect(app, bank);
    expect(await jointOf(app)).toMatchObject({ type: "checking", typeSource: "user", bankTypeCode: "LOAN" });
    // a name alone is not a choice of type
    await app.admin.call("PATCH", `/api/accounts/${(await jointOf(app)).id}`, { name: "Yhteinen" });
    expect((await jointOf(app)).typeSource).toBe("user");
  });

  it("stored as a loan by the earlier guess is set right by the next fetch, and its payments are transfers again", async () => {
    const { bank, app } = await setup();
    bank.answers["POST /sessions"] = session([checking, joint("CACC")], "sess-one");
    await connect(app, bank);
    const transfers = async () => (await app.db.all<{ id: string }>("SELECT id FROM transactions WHERE user_id = ? AND is_transfer = 1", [app.adminId])).length;
    expect(await transfers()).toBe(2);

    // what an install from before migration 0023 holds: the joint account typed loan by the earlier rule, which read
    // "loan" in a holder's name when the bank sent no code; no code read
    const id = (await jointOf(app)).id;
    await app.db.run("UPDATE accounts SET type = 'loan', bank_type_code = NULL, bank_product = NULL, type_source = NULL WHERE id = ?", [id]);
    await reprocess(app.s.finance(app.adminId), app.s.settings);
    expect(await transfers()).toBe(0);

    bank.answers["GET /accounts/u-joint/details"] = { status: 200, body: joint() };
    bank.calls.length = 0;
    expect((await app.admin.call("POST", "/api/sync")).body.status).toBe("ok");
    expect(bank.calls).toContain("GET /accounts/u-joint/details");
    expect(await jointOf(app)).toMatchObject({ type: "checking", typeSource: "bank", bankTypeCode: "", bankProduct: "Käyttötili" });
    expect(await transfers()).toBe(2);

    // read once: the next fetch does not ask again
    bank.calls.length = 0;
    await app.admin.call("POST", "/api/sync");
    expect(bank.calls.filter((c) => c.includes("/details"))).toEqual([]);
  });

  it("set by hand before the codes were kept stays the user's, at the next fetch and at the next link", async () => {
    const { bank, app } = await setup();
    bank.answers["POST /sessions"] = session([checking, joint("CACC")], "sess-one");
    await connect(app, bank);
    const id = (await jointOf(app)).id;
    // the earlier rule gives checking for a CACC current account, so savings was the user's choice
    await app.db.run("UPDATE accounts SET type = 'savings', bank_type_code = NULL, type_source = NULL WHERE id = ?", [id]);
    bank.answers["GET /accounts/u-joint/details"] = { status: 200, body: joint("CACC") };
    await app.admin.call("POST", "/api/sync");
    expect(await jointOf(app)).toMatchObject({ type: "savings", typeSource: "user", bankTypeCode: "CACC" });

    // the same by a new consent, with no fetch between
    await app.db.run("UPDATE accounts SET type = 'other', bank_type_code = NULL, type_source = NULL WHERE id = ?", [id]);
    bank.answers["POST /sessions"] = session([checking, joint("CACC")], "sess-two");
    await connect(app, bank);
    expect(await jointOf(app)).toMatchObject({ type: "other", typeSource: "user" });
    // near miss: a type the earlier rule gave from the same answer is the app's ("loan" from a holder's name with no
    // code), and a consent works it out again
    await app.db.run("UPDATE accounts SET type = 'loan', type_source = NULL WHERE id = ?", [id]);
    bank.answers["POST /sessions"] = session([checking, joint()], "sess-three");
    await connect(app, bank);
    expect(await jointOf(app)).toMatchObject({ type: "checking", typeSource: "bank" });
  });

  it("is left as it is by a fetch when the user chose it, or when the bank's answer says nothing of the account's kind", async () => {
    const { bank, app } = await setup();
    bank.answers["POST /sessions"] = session([checking, joint("CACC")], "sess-one");
    await connect(app, bank);
    const id = (await jointOf(app)).id;

    await app.db.run("UPDATE accounts SET type = 'savings', bank_type_code = NULL WHERE id = ?", [id]);
    bank.answers["GET /accounts/u-joint/details"] = { status: 200, body: { uid: "u-joint" } };
    await app.admin.call("POST", "/api/sync");
    expect(await jointOf(app)).toMatchObject({ type: "savings", bankTypeCode: "" });

    await app.admin.call("PATCH", `/api/accounts/${id}`, { type: "other" });
    await app.db.run("UPDATE accounts SET bank_type_code = NULL WHERE id = ?", [id]);
    bank.answers["GET /accounts/u-joint/details"] = { status: 200, body: joint("CACC") };
    await app.admin.call("POST", "/api/sync");
    expect(await jointOf(app)).toMatchObject({ type: "other", typeSource: "user", bankTypeCode: "CACC" });
  });
});
