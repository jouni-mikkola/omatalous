/**
 * A fetch the member starts sends each bank its own list of Psu-* headers (capabilities.ts keeps the list, psu.ts builds
 * the headers). Names and sums are made up.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { psuHeaders } from "../src/connectors/enable-banking/psu.ts";
import { setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) Esimerkki/1.0";
const FROM_OUTSIDE = { "X-Forwarded-For": "203.0.113.7", "User-Agent": BROWSER, Accept: "text/html", "Accept-Language": "fi-FI" };
const NORDEA_LIST = ["Psu-Ip-Address", "Psu-User-Agent", "Psu-Accept"];
const OP_LIST = ["Psu-Ip-Address", "Psu-Accept-Language"];

/** One link with a current account (Nordea) and a card; the card is then moved to a connection of another bank. */
async function setup(lists: Record<string, string[] | null>) {
  const bank = mockBank();
  const sent: { route: string; psu: Record<string, string> }[] = [];
  const spy = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.enablebanking.com") {
      sent.push({ route: `${init?.method ?? "GET"} ${url.pathname}`, psu: Object.fromEntries([...new Headers(init?.headers)].filter(([name]) => name.startsWith("psu-"))) });
    }
    return bank.fetchMock(input, init);
  }) as typeof fetch;
  const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem, TRUST_PROXY: "true" }, spy);
  const idle = () => waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  await app.admin.call("POST", "/api/connections/start", {});
  await app.admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` });
  await idle();
  await app.s.db.run(
    "INSERT INTO connections (id, user_id, provider, institution, country, status, valid_until, created_at) SELECT 'c-op', user_id, provider, 'OP', country, status, valid_until, created_at FROM connections LIMIT 1",
  );
  await app.s.db.run("UPDATE accounts SET connection_id = 'c-op' WHERE external_id = 'u-card'");
  const store = Object.fromEntries(Object.entries(lists).map(([id, requiredPsuHeaders]) => [id, { requiredPsuHeaders, balanceTypes: [] }]));
  await app.s.settings.set("instance_bank_capabilities", JSON.stringify(store));
  const manual = async (headers: Record<string, string>) => {
    sent.length = 0;
    await app.admin.call("POST", "/api/sync", undefined, headers);
    // the header names of the calls to a route, one entry for each different set (a paged route is called more than once)
    return (route: string) => [...new Set(sent.filter((c) => c.route.endsWith(route)).map((c) => JSON.stringify(Object.keys(c.psu).sort())))].map((j) => JSON.parse(j) as string[]);
  };
  // a backfill of older days is noted apart
  const triggers = async () => (await app.s.db.all<{ trigger: string }>("SELECT trigger FROM account_fetch WHERE trigger NOT LIKE 'backfill%' ORDER BY at, rowid")).map((r) => r.trigger);
  return { ...app, manual, triggers, idle };
}

describe("each bank's own list of Psu headers on a fetch the member starts", () => {
  it("gives two banks in one manual sync each its own headers", async () => {
    const { manual, triggers } = await setup({ "nordea-fi": NORDEA_LIST, "op-fi": OP_LIST });
    const seen = await manual(FROM_OUTSIDE);
    const nordea = ["psu-accept", "psu-ip-address", "psu-user-agent"];
    const op = ["psu-accept-language", "psu-ip-address"];
    expect(seen("/accounts/u-chk/transactions")).toEqual([nordea]);
    expect(seen("/accounts/u-chk/balances")).toEqual([nordea]);
    expect(seen("/accounts/u-card/transactions")).toEqual([op]);
    expect(seen("/accounts/u-card/balances")).toEqual([op]);
    // both had what they asked for: neither is counted as made without the member
    expect((await triggers()).slice(-2)).toEqual(["manual", "manual"]);
  });

  it("gives the default pair to a bank with no record or no list", async () => {
    const { manual } = await setup({ "op-fi": null });
    const seen = await manual(FROM_OUTSIDE);
    const pair = ["psu-ip-address", "psu-user-agent"];
    expect(seen("/accounts/u-chk/transactions")).toEqual([pair]); // Nordea has no record
    expect(seen("/accounts/u-card/transactions")).toEqual([pair]); // OP has a record without a list
  });

  it("gives no headers to a bank whose list asks for one the request cannot give, and counts that account as bare", async () => {
    const { manual, triggers } = await setup({ "nordea-fi": NORDEA_LIST, "op-fi": OP_LIST });
    const { "Accept-Language": _gone, ...noLanguage } = FROM_OUTSIDE;
    const seen = await manual(noLanguage);
    expect(seen("/accounts/u-chk/transactions")).toEqual([["psu-accept", "psu-ip-address", "psu-user-agent"]]); // near miss: Nordea's list is whole
    expect(seen("/accounts/u-card/transactions")).toEqual([[]]);
    expect(seen("/accounts/u-card/balances")).toEqual([[]]);
    expect((await triggers()).slice(-2).sort()).toEqual(["manual", "manual-bare"]);
  });

  it("sends nothing from a private address, even to a list without the address header", async () => {
    const { manual, triggers } = await setup({ "nordea-fi": ["Psu-User-Agent"], "op-fi": null });
    const seen = await manual({ ...FROM_OUTSIDE, "X-Forwarded-For": "192.168.1.20" });
    expect(seen("/accounts/u-chk/transactions")).toEqual([[]]);
    expect(seen("/accounts/u-card/transactions")).toEqual([[]]);
    expect((await triggers()).slice(-2)).toEqual(["manual-bare", "manual-bare"]);
    // near miss: the same list from a public address is sent
    expect((await manual(FROM_OUTSIDE))("/accounts/u-chk/transactions")).toEqual([["psu-user-agent"]]);
  });

  it("counts an open with the default pair as bare for the bank whose list the request cannot fill", async () => {
    const { admin, s, idle, triggers } = await setup({ "nordea-fi": NORDEA_LIST, "op-fi": ["Psu-Ip-Address", "Psu-Referer"] });
    await s.db.run("UPDATE sync_runs SET started_at = '2000-01-01T00:00:00.000Z', finished_at = '2000-01-01T00:00:00.000Z'");
    await admin.call("POST", "/api/sync/open", undefined, FROM_OUTSIDE);
    await idle();
    expect((await triggers()).slice(-2).sort()).toEqual(["open", "open-bare"]);
  });

  it("builds no headers from a private address for any list", () => {
    const header = (n: string) => (n === "user-agent" ? BROWSER : undefined);
    expect(psuHeaders("10.0.0.4", header, ["Psu-User-Agent"])).toBeNull();
    expect(psuHeaders("203.0.113.7", header, ["Psu-User-Agent"])).toEqual({ "Psu-User-Agent": BROWSER });
  });
});
