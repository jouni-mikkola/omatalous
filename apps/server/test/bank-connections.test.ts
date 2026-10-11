import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { LINK_FAILURES } from "../src/connectors/link-state.ts";
import { mockBank } from "./mock-bank.ts";
import { setupApp, waitFor } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const NOT_LINKED = "tiliä ei ole linkitetty Enable Bankingissa. Ylläpitäjä lisää sen kohdassa API applications > Omatalous > Link accounts.";

type Admin = Awaited<ReturnType<typeof setupApp>>["admin"];
type Bank = ReturnType<typeof mockBank>;

async function connect(admin: Admin, bank: Bank): Promise<string> {
  await admin.call("POST", "/api/connections/start", {});
  const done = await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` });
  expect(done.status).toBe(200);
  await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  return done.body.connectionId;
}

const meta = async (admin: Admin) => (await admin.call("GET", "/api/meta")).body;
const connection = async (admin: Admin, id: string) => (await meta(admin)).connections.find((c: { id: string }) => c.id === id);

describe("connection states", () => {
  it("a consent closed before its date reads katkesi, and a reconnect makes it history that can leave the list", async () => {
    const bank = mockBank();
    const { admin, member } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const old = await connect(admin, bank);
    expect(await connection(admin, old)).toMatchObject({ status: "active", state: "active", history: false, daysLeft: 179 });

    // the bank closed the consent months before its valid_until
    bank.answers["GET /accounts/u-chk/transactions"] = { status: 401, body: { code: 401, error: "CLOSED_SESSION", message: "Session is closed" } };
    const sync = await admin.call("POST", "/api/sync");
    expect(sync.body.messages).toEqual(["Nordea: yhteys katkesi. Yhdistä uudelleen."]);
    expect(await connection(admin, old)).toMatchObject({ status: "expired", state: "broken", history: false, daysLeft: null });

    // a new consent moves both accounts in the same request: the old one owns nothing and is history
    delete bank.answers["GET /accounts/u-chk/transactions"];
    const fresh = await connect(admin, bank);
    const after = await meta(admin);
    expect(after.accounts.every((a: { connectionId: string }) => a.connectionId === fresh)).toBe(true);
    expect(after.connections.find((c: { id: string }) => c.id === old)).toMatchObject({ state: "broken", history: true });
    expect(after.connections.find((c: { id: string }) => c.id === fresh)).toMatchObject({ state: "active", history: false });

    // "Poista listalta": refused while the row owns an account, and for another member's row
    expect((await admin.call("DELETE", `/api/connections/history/${fresh}`)).status).toBe(400);
    const eero = await member("eero");
    expect((await eero.call("DELETE", `/api/connections/history/${old}`)).status).toBe(404);
    expect((await admin.call("DELETE", `/api/connections/history/${old}`)).status).toBe(200);
    expect((await meta(admin)).connections.map((c: { id: string }) => c.id)).toEqual([fresh]);
  });

  it("an account a newer consent did not bring keeps its ended consent, which reads replaced; without a newer one it is katkesi", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const old = await connect(admin, bank);
    bank.answers["GET /accounts/u-chk/transactions"] = { status: 401, body: { code: 401, error: "CLOSED_SESSION", message: "Session is closed" } };
    await admin.call("POST", "/api/sync");
    expect(await connection(admin, old)).toMatchObject({ state: "broken", history: false, replaced: false });
    delete bank.answers["GET /accounts/u-chk/transactions"];

    // a restricted application leaves the card out of the new session: it is not under Linked accounts
    bank.answers["POST /sessions"] = {
      status: 200,
      body: {
        session_id: "sess-new",
        aspsp: { name: "Nordea", country: "FI" },
        access: { valid_until: "2027-04-06T00:00:00Z" },
        accounts: [{ uid: "u-chk", identification_hash: "h-chk", account_id: { iban: "FI2112345600000785" }, name: "Käyttötili", currency: "EUR", cash_account_type: "CACC" }],
      },
    };
    const fresh = await connect(admin, bank);
    const after = await meta(admin);
    const byName = (name: string) => after.accounts.find((a: { name: string }) => a.name === name);
    expect(byName("Käyttötili").connectionId).toBe(fresh);
    expect(byName("Nordea Gold").connectionId).toBe(old);
    expect(after.connections.find((c: { id: string }) => c.id === old)).toMatchObject({ state: "broken", history: false, replaced: true });
    expect(after.connections.find((c: { id: string }) => c.id === fresh)).toMatchObject({ state: "active", history: false, replaced: false });
  });

  it("a passed date reads vanhentui with that date", async () => {
    const bank = mockBank();
    const { admin, s, adminId } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const id = await connect(admin, bank);
    const repo = s.finance(adminId);
    const conn = (await repo.listConnections())[0]!;
    await repo.upsertConnection({ ...conn, validUntil: "2026-10-01T00:00:00Z" });
    expect(await connection(admin, id)).toMatchObject({ status: "expired", state: "lapsed", history: false, daysLeft: null });
    expect((await admin.call("POST", "/api/sync")).body.messages).toEqual(["Nordea: yhteys vanhentui 1.10.2026. Yhdistä uudelleen."]);
  });

  it("a consent the user removed stays in the table while it owns accounts", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const id = await connect(admin, bank);
    expect((await admin.call("DELETE", `/api/connections/${id}`)).status).toBe(200);
    expect(await connection(admin, id)).toMatchObject({ status: "revoked", state: "removed", history: false });
  });
});

describe("per-account errors", () => {
  it("an account the application may not read gets its own message, and the other accounts are fetched", async () => {
    const bank = mockBank();
    const { admin, s, adminId } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await connect(admin, bank);
    // the first account in the loop fails: a 403 here once ended the whole consent's loop as a rejected key
    bank.answers["GET /accounts/u-chk/transactions"] = { status: 403, body: { code: 403, error: "NO_ACCOUNTS_ADDED", message: "No allowed accounts added to the application" } };
    bank.calls.length = 0;
    const sync = await admin.call("POST", "/api/sync");
    expect(sync.body).toMatchObject({ status: "partial", messages: [`Käyttötili: ${NOT_LINKED}`] });
    // asked once: a shorter window would not help
    expect(bank.calls.filter((c) => c.startsWith("GET /accounts/u-chk/transactions"))).toHaveLength(1);
    expect(bank.calls.some((c) => c.startsWith("GET /accounts/u-card/balances"))).toBe(true);

    const accounts = (await meta(admin)).accounts as { name: string; problem: { kind: string; message: string } | null }[];
    expect(accounts.find((a) => a.name === "Käyttötili")!.problem).toEqual({ kind: "not_linked", message: NOT_LINKED });
    expect(accounts.find((a) => a.name === "Nordea Gold")!.problem).toBeNull();

    // linked in the Control Panel: the next fetch clears the state
    delete bank.answers["GET /accounts/u-chk/transactions"];
    expect((await admin.call("POST", "/api/sync")).body.status).toBe("ok");
    expect((await meta(admin)).accounts.every((a: { problem: unknown }) => a.problem === null)).toBe(true);
    expect(await s.settings.get(`fetch_problems:${adminId}`)).toBeNull();
  });

  it("a refusal of one account's key goes on to the next account and is said once", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await connect(admin, bank);
    bank.answers["GET /accounts/u-chk/transactions"] = { status: 403, body: { code: 403, error: "ACCESS_DENIED", message: "Access to this resource is denied" } };
    bank.calls.length = 0;
    const sync = await admin.call("POST", "/api/sync");
    expect(sync.body.status).toBe("partial");
    expect(sync.body.messages).toHaveLength(1);
    expect(bank.calls.some((c) => c.startsWith("GET /accounts/u-card/transactions"))).toBe(true);
  });

  it("another failure shows on the account row with the bank's status and code", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await connect(admin, bank);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    bank.answers["GET /accounts/u-card/balances"] = { status: 500, body: { code: 500, error: "ASPSP_ERROR", message: "Error interacting with ASPSP" } };
    expect((await admin.call("POST", "/api/sync")).body.messages).toEqual(["Nordea Gold: pankki vastasi virheellä 500 (ASPSP_ERROR)."]);
    const card = (await meta(admin)).accounts.find((a: { name: string }) => a.name === "Nordea Gold");
    expect(card.problem).toEqual({ kind: "failed", message: "pankki vastasi virheellä 500 (ASPSP_ERROR)." });
    errors.mockRestore();
  });
});

describe("linking ends in one message (no retry loop)", () => {
  const authStates = async (s: Awaited<ReturnType<typeof setupApp>>["s"]) => s.settings.keysWithPrefix("auth_state:");

  it("an application the last test found not active stops at the start, before the bank, and the picker says why", async () => {
    const bank = mockBank();
    const { admin, s } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    bank.answers["GET /application"] = { status: 200, body: { active: false } };
    expect((await admin.call("POST", "/api/admin/bank-app/test")).body.result.active).toBe(false);
    expect((await meta(admin)).bank).toMatchObject({ configured: false, inactive: true });

    const r = await admin.call("POST", "/api/connections/start", {});
    expect(r).toMatchObject({ status: 400, body: { error: LINK_FAILURES.inactive } });
    expect(bank.calls.some((c) => c.startsWith("POST /auth"))).toBe(false);
    expect(await authStates(s)).toEqual([]);

    // linked in the Control Panel since: the start asks again, goes on and saves the new answer
    bank.answers["GET /application"] = { status: 200, body: { active: true } };
    expect((await admin.call("POST", "/api/connections/start", {})).status).toBe(200);
    expect((await meta(admin)).bank).toMatchObject({ configured: true, inactive: false });
  });

  it("an old inactive answer never blocks a start when Enable Banking gives no flag or no answer", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const answer of [{ status: 200, body: {} }, { status: 500, body: { error: "INTERNAL" } }, { status: 408, body: { error: "ASPSP_TIMEOUT" } }]) {
      bank.answers["GET /application"] = { status: 200, body: { active: false } };
      await admin.call("POST", "/api/admin/bank-app/test");
      bank.answers["GET /application"] = answer;
      expect((await admin.call("POST", "/api/connections/start", {})).status, JSON.stringify(answer)).toBe(200);
    }
    errors.mockRestore();
  });

  it("a 4xx from starting the authorisation names who fixes it and leaves no state", async () => {
    const bank = mockBank();
    const { admin, s } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: [number, string, keyof typeof LINK_FAILURES][] = [
      [403, "ACCESS_DENIED", "inactive"],
      [401, "UNAUTHORIZED_ACCESS", "app"],
      [422, "WRONG_REQUEST_PARAMETERS", "refused"],
    ];
    for (const [status, error, reason] of cases) {
      bank.answers["POST /auth"] = { status, body: { code: status, error, message: "x" } };
      const r = await admin.call("POST", "/api/connections/start", {});
      expect(r, `${status} ${error}`).toMatchObject({ status: 400, body: { error: LINK_FAILURES[reason] } });
    }
    expect(await authStates(s)).toEqual([]);
    errors.mockRestore();
  });

  it("an error redirect says what happened, uses up the state, and a pasted error address gets the same words", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const location = async (query: string) => (await admin.call("GET", `/api/connections/callback?${query}`)).res.headers.get("location");

    await admin.call("POST", "/api/connections/start", {});
    expect(await location(`error=access_denied&state=${bank.state}`)).toMatch(/#\/settings\?error=cancelled$/);
    // the state went with the error: its code cannot complete afterwards
    expect((await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` })).body.error).toBe(LINK_FAILURES.expired);

    await admin.call("POST", "/api/connections/start", {});
    expect(await location(`error=server_error&state=${bank.state}`)).toMatch(/#\/settings\?error=bank$/);

    // paste mode: the bank's error page address, pasted twice, gives the same message both times
    await admin.call("POST", "/api/connections/start", {});
    for (let i = 0; i < 2; i++) {
      const r = await admin.call("POST", "/api/connections/complete", { url: `https://localhost/api/connections/callback?error=access_denied&state=${bank.state}` });
      expect(r).toMatchObject({ status: 400, body: { error: LINK_FAILURES.cancelled } });
    }
    expect(bank.calls.filter((c) => c.startsWith("POST /sessions"))).toEqual([]);
  });

  it("the web app shows the callback's reasons in the words a pasted address gets", () => {
    const web = readFileSync(new URL("../../web/src/pages/settings/BankConnections.tsx", import.meta.url), "utf8");
    for (const [reason, text] of Object.entries(LINK_FAILURES)) expect(web, reason).toContain(`  ${reason}: ${JSON.stringify(text)},`);
  });

  it("a 4xx from creating the session ends in one reason, with no connection and no fetch", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: [number, string, keyof typeof LINK_FAILURES][] = [
      [403, "ACCESS_DENIED", "inactive"],
      [401, "UNAUTHORIZED_ACCESS", "app"],
      [400, "EXPIRED_AUTHORIZATION_CODE", "expired"],
      [422, "WRONG_REQUEST_PARAMETERS", "refused"],
    ];
    for (const [status, error, reason] of cases) {
      bank.answers["POST /sessions"] = { status, body: { code: status, error, message: "x" } };
      await admin.call("POST", "/api/connections/start", {});
      const r = await admin.call("GET", `/api/connections/callback?code=abc&state=${bank.state}`);
      expect(r.res.headers.get("location"), `${status} ${error}`).toMatch(new RegExp(`#/settings\\?error=${reason}$`));
      await admin.call("POST", "/api/connections/start", {});
      expect((await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` })).body.error).toBe(LINK_FAILURES[reason]);
    }
    // each attempt asked once, nothing was stored and no fetch started
    expect(bank.calls.filter((c) => c.startsWith("POST /sessions"))).toHaveLength(cases.length * 2);
    expect((await meta(admin)).connections).toEqual([]);
    expect((await admin.call("GET", "/api/sync/runs")).body.runs).toEqual([]);
    errors.mockRestore();
  });
});
