/**
 * The fetches a bank allows without the user present, counted per account from the calls noted in `account_fetch`; a
 * consent whose session ended is marked for renewal; the admin's test of the redirect URL. Made-up data.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { accountsAtLimit } from "../src/connectors/bank-limit.ts";
import { syncUser } from "../src/connectors/sync.ts";
import { accountKey } from "../src/db/household-repo.ts";
import { NOW, setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const HOUR = 3600_000;

/** A linked bank with a checking account (u-chk) and a card (u-card); the link's own fetch is done. */
async function connected(env: Record<string, string> = {}) {
  const bank = mockBank();
  const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem, ...env }, bank.fetchMock);
  await app.admin.call("POST", "/api/connections/start", {});
  await app.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
  await waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  await app.s.db.run("DELETE FROM account_fetch"); // the link's own fetch had no headers and was counted: the tests start from none
  const accounts = await app.s.finance(app.adminId).listAccounts();
  const chk = accountKey(accounts.find((a) => a.externalId === "u-chk")!);
  const card = accountKey(accounts.find((a) => a.externalId === "u-card")!);
  /** Notes `n` calls of `trigger` for the account, `hoursAgo` before now, made by the member. */
  const note = async (key: string, trigger: string, n: number, hoursAgo = 1, userId = app.adminId) => {
    for (let i = 0; i < n; i++) await app.s.finance(userId).recordFetch(key, new Date(NOW.getTime() - hoursAgo * HOUR), trigger);
  };
  /** The calls to the bank for balances, per account uid, from now on. */
  const mark = bank.calls.length;
  const balanceCalls = () => bank.calls.slice(mark).filter((c) => c.includes("/balances")).map((c) => c.split("/")[2]);
  return { ...app, bank, chk, card, note, balanceCalls };
}

describe("the unattended fetches of an account", () => {
  it("skips the account at its limit and still fetches the member's other account", async () => {
    const { s, adminId, chk, note, balanceCalls } = await connected();
    await note(chk, "schedule", 4);
    const summary = await syncUser(s, adminId, "schedule");
    expect(summary.status).toBe("ok");
    expect(balanceCalls()).toEqual(["u-card"]);
  });

  it("fetches an account that is one short of its limit", async () => {
    const { s, adminId, chk, note, balanceCalls } = await connected();
    await note(chk, "schedule", 3);
    await syncUser(s, adminId, "schedule");
    expect(balanceCalls().sort()).toEqual(["u-card", "u-chk"]);
  });

  it("counts a joint account once, whoever fetched it, so two members share the four", async () => {
    const { s, adminId, member, chk, card, note, balanceCalls } = await connected();
    const maija = await member("maija");
    await note(chk, "schedule", 2, 3, adminId);
    await note(chk, "schedule", 2, 2, maija.id);
    await syncUser(s, adminId, "schedule");
    expect(balanceCalls()).toEqual(["u-card"]); // 2 + 2 of the one account
    // near miss: 2 + 1 is room for the fourth
    await s.db.run("DELETE FROM account_fetch WHERE user_id = ?", [maija.id]);
    await note(chk, "schedule", 1, 2, maija.id);
    await syncUser(s, adminId, "schedule");
    expect(balanceCalls().filter((u) => u === "u-chk")).toHaveLength(1);
    // that fourth call is the account's last for the day, and the other key is not held up by it
    expect((await accountsAtLimit(s, [chk, card], "schedule"))).toEqual(new Set([chk]));
  });

  it("does not count a fetch the user started, and a user-started fetch goes on at the limit", async () => {
    const { s, adminId, chk, note, balanceCalls } = await connected();
    for (const trigger of ["manual", "connect", "open"]) await note(chk, trigger, 4);
    await syncUser(s, adminId, "schedule");
    expect(balanceCalls().sort()).toEqual(["u-card", "u-chk"]);

    await note(chk, "schedule", 4);
    expect([...(await accountsAtLimit(s, [chk], "schedule"))]).toEqual([chk]);
    for (const trigger of ["manual", "connect", "open"]) expect((await accountsAtLimit(s, [chk], trigger)).size).toBe(0);
    await syncUser(s, adminId, "manual");
    expect(balanceCalls().filter((u) => u === "u-chk")).toHaveLength(2);
  });

  it("counts a manual or connect fetch that carried no headers like an open without them, and never refuses it", async () => {
    const { admin, s, adminId, chk, bank, note, balanceCalls } = await connected({ TRUST_PROXY: "true" });
    const triggers = () => s.db.all<{ trigger: string }>("SELECT trigger FROM account_fetch WHERE account_key = ? ORDER BY id", [chk]);
    // no headers can be given (no proxy header: the address is the word local): noted as bare
    await syncUser(s, adminId, "manual");
    await syncUser(s, adminId, "connect");
    expect((await triggers()).map((r) => r.trigger).slice(-2)).toEqual(["manual-bare", "connect-bare"]);
    expect((await accountsAtLimit(s, [chk], "schedule")).size).toBe(0); // the two above
    await note(chk, "schedule", 1);
    expect((await accountsAtLimit(s, [chk], "schedule")).size).toBe(0); // three
    await note(chk, "schedule", 1);
    expect((await accountsAtLimit(s, [chk], "schedule")).size).toBe(1); // the fourth
    const calls = balanceCalls().length;
    await syncUser(s, adminId, "manual"); // asked for by the user: made, and counted
    expect(balanceCalls().length).toBe(calls + 2);
    expect((await triggers()).at(-1)).toEqual({ trigger: "manual-bare" });

    // near miss: with the member's headers it is a fetch made with the user present, and not counted
    await s.db.run("DELETE FROM account_fetch");
    const headers = { "X-Forwarded-For": "203.0.113.7", "User-Agent": "Mozilla/5.0 Esimerkki/1.0" };
    expect((await admin.call("POST", "/api/sync", undefined, headers)).status).toBe(200);
    expect((await triggers()).map((r) => r.trigger)).toEqual(["manual"]);
    expect(bank.calls.length).toBeGreaterThan(0);
    await note(chk, "schedule", 3);
    expect((await accountsAtLimit(s, [chk], "schedule")).size).toBe(0);
  });

  it("keeps the scheduled fetches their room: an open without headers stops at four less the sync hours", async () => {
    const { s, chk, note } = await connected({ SYNC_HOURS: "6,18" });
    await note(chk, "open-bare", 1);
    expect((await accountsAtLimit(s, [chk], "open-bare")).size).toBe(0);
    await note(chk, "open-bare", 1);
    expect((await accountsAtLimit(s, [chk], "open-bare")).size).toBe(1);
    // the scheduled fetch of the day is still fine with two opens and one scheduled so far
    await note(chk, "schedule", 1);
    expect((await accountsAtLimit(s, [chk], "schedule")).size).toBe(0);
    await note(chk, "schedule", 1);
    expect((await accountsAtLimit(s, [chk], "schedule")).size).toBe(1);
  });

  it("starts counting again when the bank's day is over", async () => {
    const { s, adminId, chk, note, balanceCalls } = await connected();
    await note(chk, "schedule", 4, 23.5); // a scheduled call 23.5 hours ago is yesterday's slot: left out at the same hour
    await syncUser(s, adminId, "schedule");
    expect(balanceCalls().sort()).toEqual(["u-card", "u-chk"]);
    await s.db.run("DELETE FROM account_fetch WHERE trigger = 'schedule'");
    await note(chk, "schedule", 4, 20);
    expect((await accountsAtLimit(s, [chk], "schedule")).size).toBe(1);
    await s.db.run("UPDATE account_fetch SET at = ? WHERE trigger = 'schedule'", [new Date(NOW.getTime() - 25 * HOUR).toISOString()]);
    expect((await accountsAtLimit(s, [chk], "schedule")).size).toBe(0);
    await note(chk, "open-bare", 4, 25);
    expect((await accountsAtLimit(s, [chk], "open-bare")).size).toBe(0);
  });

  it("answers limited to an open without headers only when every account is at its limit, and still starts one with headers", async () => {
    const { admin, s, adminId, chk, card, note } = await connected({ TRUST_PROXY: "true" });
    await s.db.run("UPDATE sync_runs SET started_at = ?, finished_at = ? WHERE user_id = ?", [new Date(Date.now() - 2 * HOUR).toISOString(), new Date(Date.now() - 2 * HOUR).toISOString(), adminId]);
    await note(chk, "schedule", 4);
    const one = await admin.call("POST", "/api/sync/open");
    expect(one.body.state).toBe("running"); // the card still has room
    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
    await s.db.run("UPDATE sync_runs SET started_at = ?, finished_at = ? WHERE user_id = ?", [new Date(Date.now() - 2 * HOUR).toISOString(), new Date(Date.now() - 2 * HOUR).toISOString(), adminId]);
    await note(card, "schedule", 4);
    expect((await admin.call("POST", "/api/sync/open")).body.state).toBe("limited");
    const headers = { "X-Forwarded-For": "203.0.113.7", "User-Agent": "Mozilla/5.0 Esimerkki/1.0" };
    expect((await admin.call("POST", "/api/sync/open", undefined, headers)).body.state).toBe("running");
  });
});

describe("a consent whose session ended", () => {
  it("is marked for renewal, fetches nothing more unattended, and keeps what is stored", async () => {
    const { admin, s, adminId, bank, balanceCalls } = await connected();
    const rowsBefore = (await s.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM transactions"))!.n;
    const view = async () => (await admin.call("GET", "/api/meta")).body.connections[0];
    expect(await view()).toMatchObject({ state: "active", needsRenewal: false });

    bank.answers["GET /accounts/u-chk/balances"] = { status: 401, body: { error: "EXPIRED_SESSION" } };
    const summary = await syncUser(s, adminId, "manual");
    expect(summary.status).toBe("failed");
    expect(await view()).toMatchObject({ state: "broken", needsRenewal: true });

    bank.answers = {};
    const calls = balanceCalls().length;
    const again = await syncUser(s, adminId, "schedule");
    expect(again.status).toBe("ok");
    expect(balanceCalls()).toHaveLength(calls); // no call on an ended consent
    expect((await s.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM transactions"))!.n).toBe(rowsBefore);
    expect(await s.finance(adminId).listAccounts()).toHaveLength(2);
  });

  it("is marked for renewal when its date has passed, before any fetch notices", async () => {
    const { admin, s, adminId } = await connected();
    const [conn] = await s.finance(adminId).listConnections();
    await s.db.run("UPDATE connections SET valid_until = '2026-10-01T00:00:00Z' WHERE id = ?", [conn!.id]);
    const c = (await admin.call("GET", "/api/meta")).body.connections[0];
    expect(c).toMatchObject({ state: "lapsed", needsRenewal: true });
    await syncUser(s, adminId, "schedule");
    expect((await s.finance(adminId).listConnections())[0]!.status).toBe("expired");
  });
});

describe("the redirect self-test", () => {
  const test = (admin: { call: (m: string, p: string) => Promise<{ status: number; body: any }> }) => admin.call("POST", "/api/admin/bank-app/redirect-test");

  it("answers ok when Enable Banking accepts the redirect URL, and leaves no link state behind", async () => {
    const { admin, bank, s } = await connected();
    const before = bank.calls.length;
    const r = await test(admin);
    expect(r).toMatchObject({ status: 200, body: { result: "ok" } });
    expect(bank.calls.slice(before)).toEqual(["GET /aspsps?country=FI&service=AIS", "POST /auth"]); // nothing after the authorisation
    expect(bank.redirectUrl).toBe(s.redirectUrl());
    expect(await s.db.all("SELECT 1 FROM settings WHERE key LIKE 'link_state%'")).toEqual([]);
  });

  it("answers redirect_not_allowed when the address is not among the application's Redirect URLs", async () => {
    const { admin, bank } = await connected();
    bank.authFailure = { status: 422, body: JSON.stringify({ code: 422, message: "Redirect URI not allowed", error: "REDIRECT_URI_NOT_ALLOWED" }) };
    expect((await test(admin)).body).toEqual({ result: "redirect_not_allowed" });
  });

  it("answers error for any other refusal, and for a missing bank list, without the body in the answer", async () => {
    const { admin, bank } = await connected();
    bank.authFailure = { status: 500, body: JSON.stringify({ error: "ASPSP_ERROR", message: "Account FI2112345600000785" }) };
    const r = await test(admin);
    expect(r.body).toEqual({ result: "error" });
    bank.authFailure = null;
    bank.answers["GET /aspsps"] = { status: 200, body: { aspsps: [{ name: "Aktia", country: "FI" }] } };
    expect((await test(admin)).body).toEqual({ result: "error" });
  });

  it("is for an admin only", async () => {
    const { member, bank } = await connected();
    const maija = await member("maija");
    const before = bank.calls.length;
    expect((await maija.call("POST", "/api/admin/bank-app/redirect-test")).status).toBe(403);
    expect(bank.calls).toHaveLength(before);
  });
});
