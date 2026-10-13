import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { EnableBankingError } from "../src/connectors/enable-banking/client.ts";
import { psuHeaders } from "../src/connectors/enable-banking/psu.ts";
import { syncEveryone } from "../src/connectors/sync.ts";
import { mockBank } from "./mock-bank.ts";
import { type Client, setupApp, waitFor } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) Esimerkki/1.0";
/** A member on the internet: the proxy wrote the address (TRUST_PROXY), the browser its name. */
const FROM_OUTSIDE = { "X-Forwarded-For": "203.0.113.7", "User-Agent": BROWSER };

/** The booking the fake bank adds to the checking account: one new row for the next fetch. */
const NEW_BOOKING = {
  status: 200,
  body: {
    transactions: [
      {
        entry_reference: "n1",
        transaction_amount: { currency: "EUR", amount: "12.50" },
        credit_debit_indicator: "DBIT",
        status: "BOOK",
        booking_date: "2026-10-08",
        remittance_information: ["KAHVILA ESIMERKKI"],
        creditor: { name: "KAHVILA ESIMERKKI OY" },
      },
    ],
  },
};

async function setup(env: Record<string, string> = {}) {
  const bank = mockBank();
  /** Every call to the bank with the Psu-* headers it carried. */
  const sent: { route: string; psu: Record<string, string> }[] = [];
  const spy = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.enablebanking.com") {
      const psu = Object.fromEntries([...new Headers(init?.headers)].filter(([name]) => name.startsWith("psu-")));
      sent.push({ route: `${init?.method ?? "GET"} ${url.pathname}`, psu });
    }
    return bank.fetchMock(input, init);
  }) as typeof fetch;
  const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem, TRUST_PROXY: "true", ...env }, spy);

  async function connect(client: Client) {
    await client.call("POST", "/api/connections/start", {});
    await client.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    await idle(client);
  }
  const idle = (client: Client) => waitFor(async () => (await client.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  const open = (client: Client, headers: Record<string, string> = {}) => client.call("POST", "/api/sync/open", undefined, headers);
  /** Makes every stored run of the member older than the half hour, as if the app had been left alone. */
  const age = async (userId: string, hours = 2) => {
    const at = new Date(Date.now() - hours * 3600_000).toISOString();
    await app.s.db.run("UPDATE sync_runs SET started_at = ?, finished_at = ? WHERE user_id = ?", [at, at, userId]);
  };
  /** Forgets the member's runs, so the count of the day starts again. */
  const clear = (userId: string) => app.s.db.run("DELETE FROM sync_runs WHERE user_id = ?", [userId]);
  const addRun = (userId: string, trigger: string, minutesAgo: number, status = "ok") => {
    const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    return app.s.db.run("INSERT INTO sync_runs (user_id, trigger, started_at, finished_at, status, fetched, inserted) VALUES (?, ?, ?, ?, ?, 0, 0)", [userId, trigger, at, at, status]);
  };
  const balanceCalls = () => bank.calls.filter((c) => c.includes("/balances")).length;
  await connect(app.admin);
  return { ...app, bank, sent, connect, idle, open, age, clear, addRun, balanceCalls };
}

describe("a fetch when a member opens the app", () => {
  it("says none when the member has no connection, and fetches nothing", async () => {
    const { admin, member, bank, open } = await setup();
    const eero = await member("eero");
    expect((await open(eero)).body).toEqual({ state: "none", lastAt: null, inserted: 0, nextAt: null });
    expect(bank.calls.filter((c) => c.includes("/balances"))).toHaveLength(2); // only aino's own connect fetch
    expect((await open(admin)).body.state).toBe("fresh");
  });

  it("starts one fetch for stale rows and answers running, then fresh with the count of new rows", async () => {
    const { admin, adminId, bank, open, age, idle, balanceCalls } = await setup();
    // right after a fetch nothing is started
    const before = balanceCalls();
    const first = (await open(admin)).body; // the rows the connect fetch brought
    expect(first.state).toBe("fresh");
    expect(first.inserted).toBeGreaterThan(0);
    expect(balanceCalls()).toBe(before);

    await age(adminId);
    bank.answers["GET /accounts/u-chk/transactions"] = NEW_BOOKING;
    const started = await open(admin);
    expect(started.status).toBe(200);
    expect(started.body.state).toBe("running");
    await idle(admin);
    const done = await open(admin);
    expect(done.body).toMatchObject({ state: "fresh", inserted: 1 });
    expect(Date.parse(done.body.lastAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(balanceCalls()).toBe(before + 2); // one fetch: the checking account and the card
  });

  it("starts one fetch when two opens come at the same moment", async () => {
    const { admin, adminId, open, age, idle, balanceCalls, bank } = await setup();
    await age(adminId);
    const before = balanceCalls();
    // the bank takes a moment, so the first fetch is still under way when the second call looks
    const slow = bank.fetchMock;
    bank.fetchMock = (async (input, init) => (await new Promise((r) => setTimeout(r, 40)), slow(input, init))) as typeof fetch;
    const [a, b] = await Promise.all([open(admin), open(admin)]);
    expect([a.body.state, b.body.state]).toEqual(["running", "running"]);
    await idle(admin);
    expect(balanceCalls()).toBe(before + 2);
  });

  it("fetches only the caller's own connections", async () => {
    const { admin, adminId, member, connect, open, age, idle, s } = await setup();
    const eero = await member("eero");
    await connect(eero);
    await age(adminId);
    await age(eero.id);
    const eeroRuns = (await s.finance(eero.id).listSyncRuns(20)).length;
    const adminRuns = (await s.finance(adminId).listSyncRuns(20)).length;

    expect((await open(admin)).body.state).toBe("running");
    await idle(admin);
    expect((await s.finance(adminId).listSyncRuns(20)).length).toBe(adminRuns + 1);
    expect((await s.finance(eero.id).listSyncRuns(20)).length).toBe(eeroRuns);
  });

  it("does not retry a failed fetch for half an hour", async () => {
    const { admin, adminId, open, age, clear, addRun, balanceCalls } = await setup();
    await age(adminId);
    await addRun(adminId, "manual", 5, "failed");
    const before = balanceCalls();
    const answer = await open(admin);
    expect(answer.body.state).toBe("failed");
    expect(answer.body.lastAt).not.toBeNull(); // the last fetch that worked
    expect(balanceCalls()).toBe(before);

    await clear(adminId); // the failure is old now
    await addRun(adminId, "manual", 40, "failed");
    expect((await open(admin)).body.state).toBe("running");
  });
});

describe("the user's headers", () => {
  it("sends the public address and the browser name on balances and transactions, and nothing on a scheduled fetch", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    const { admin, adminId, s, open, age, idle, sent } = await setup();
    await age(adminId);
    sent.length = 0;
    expect((await open(admin, FROM_OUTSIDE)).body.state).toBe("running");
    await idle(admin);

    const reads = sent.filter((c) => /\/(balances|transactions)$/.test(c.route));
    expect(reads).toHaveLength(5); // the checking account has two pages of rows
    for (const call of reads) expect(call.psu).toEqual({ "psu-ip-address": "203.0.113.7", "psu-user-agent": BROWSER });
    expect(sent.filter((c) => !reads.includes(c) && Object.keys(c.psu).length)).toEqual([]);

    sent.length = 0;
    await syncEveryone(s, "schedule");
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.filter((c) => Object.keys(c.psu).length)).toEqual([]);

    // the values are data for the bank, never for a log
    const logged = JSON.stringify(logs.flatMap((l) => l.mock.calls));
    expect(logged).not.toContain("203.0.113.7");
    expect(logged).not.toContain("Esimerkki/1.0");
    vi.restoreAllMocks();
  });

  it("sends none from the home network, for the word local, or when the browser name is missing", async () => {
    const { admin, adminId, open, clear, idle, sent } = await setup();
    const cases: Record<string, string>[] = [
      { "X-Forwarded-For": "192.168.1.20", "User-Agent": BROWSER }, // private address
      { "User-Agent": BROWSER }, // no proxy header: the address is the word local
      { "X-Forwarded-For": "203.0.113.7" }, // a public address but no browser name
    ];
    for (const headers of cases) {
      await clear(adminId);
      sent.length = 0;
      expect((await open(admin, headers)).body.state).toBe("running");
      await idle(admin);
      expect(sent.filter((c) => /\/(balances|transactions)$/.test(c.route)).length).toBeGreaterThan(0);
      expect(sent.filter((c) => Object.keys(c.psu).length)).toEqual([]);
    }
  });

  it("caps a value at 256 characters", async () => {
    const { admin, adminId, open, age, idle, sent } = await setup();
    await age(adminId);
    sent.length = 0;
    await open(admin, { ...FROM_OUTSIDE, "User-Agent": "A".repeat(300) });
    await idle(admin);
    expect(sent.find((c) => c.route.endsWith("/balances"))?.psu["psu-user-agent"]).toBe("A".repeat(256));
  });

  const browser = (name: string) => (name === "user-agent" ? BROWSER : name === "accept-language" ? "fi-FI,fi;q=0.9" : undefined);

  it("gives all required headers or none", () => {
    expect(psuHeaders("203.0.113.7", browser)).toEqual({ "Psu-Ip-Address": "203.0.113.7", "Psu-User-Agent": BROWSER });
    // each required header missing in turn: none
    expect(psuHeaders("203.0.113.7", () => undefined)).toBeNull();
    expect(psuHeaders("203.0.113.7", (n) => (n === "user-agent" ? "   " : undefined))).toBeNull();
    expect(psuHeaders("local", browser)).toBeNull();
    expect(psuHeaders("", browser)).toBeNull();
    // a bank that requires one more: it is taken from the browser's own header, and one missing means none
    const more = ["Psu-Ip-Address", "Psu-User-Agent", "Psu-Accept-Language"];
    expect(psuHeaders("203.0.113.7", browser, more)).toEqual({ "Psu-Ip-Address": "203.0.113.7", "Psu-User-Agent": BROWSER, "Psu-Accept-Language": "fi-FI,fi;q=0.9" });
    expect(psuHeaders("203.0.113.7", (n) => (n === "user-agent" ? BROWSER : undefined), more)).toBeNull();
    expect(psuHeaders("203.0.113.7", browser, ["Psu-Referer"])).toBeNull(); // a header the app cannot give
    expect(psuHeaders("203.0.113.7", browser, [])).toBeNull();
  });

  it("sends only a public address", () => {
    const sends = (ip: string) => psuHeaders(ip, browser) !== null;
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.10.10", "100.64.0.1", "0.0.0.0", "224.0.0.1"]) expect(sends(ip), ip).toBe(false);
    for (const ip of ["fd12:3456::1", "fc00::1", "fe80::1", "febf::1", "::1", "::", "ff02::1", "::ffff:192.168.1.5", "::ffff:127.0.0.1", "fe80::1%eth0"]) expect(sends(ip), ip).toBe(false);
    for (const ip of ["not an address", "300.1.1.1", "203.0.113.7 ", "1.2.3.4, 5.6.7.8"]) expect(sends(ip), ip).toBe(false);
    // near misses: just outside the private ranges, and public IPv6
    for (const ip of ["172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "169.255.0.1", "192.169.0.1", "11.0.0.1", "203.0.113.7", "198.51.100.9"]) expect(sends(ip), ip).toBe(true);
    for (const ip of ["2001:db8::1", "fec0::1", "fb00::1", "::ffff:203.0.113.9"]) expect(sends(ip), ip).toBe(true);
  });

  it("removes line breaks and control characters from a value and caps it", () => {
    const evil = psuHeaders("203.0.113.7", (n) => (n === "user-agent" ? "Mozilla/5.0\r\nX-Evil: 1\n\tx\u0000" : undefined));
    expect(evil?.["Psu-User-Agent"]).toBe("Mozilla/5.0X-Evil: 1x");
    expect(psuHeaders("203.0.113.7", () => "\r\n")).toBeNull();
    expect(psuHeaders("203.0.113.7", () => "B".repeat(1000))?.["Psu-User-Agent"]).toHaveLength(256);
  });
});

describe("inside what the bank allows", () => {
  // one sync hour a day: four fetches without the user, one kept for the scheduled one, so three may be started
  it("allows the third fetch without headers and answers limited with the next sync hour for the next", async () => {
    const { admin, adminId, open, age, addRun, idle, balanceCalls, s } = await setup({ SYNC_HOURS: "6" });
    await age(adminId); // the connect fetch is the first
    await addRun(adminId, "manual", 180); // the second
    const before = balanceCalls();
    expect((await open(admin)).body.state).toBe("running"); // the third
    await idle(admin);
    expect(balanceCalls()).toBe(before + 2);

    await age(adminId);
    const limited = await open(admin);
    expect(limited.body).toMatchObject({ state: "limited", inserted: 0 });
    // 9.10.2026 is 13:00 in Helsinki, so the next 6:00 is the next morning, 03:00 UTC
    expect(limited.body.nextAt).toBe("2026-10-10T03:00:00.000Z");
    expect(balanceCalls()).toBe(before + 2);

    // near miss: a fetch that carried the headers is not counted, so room is left
    await s.db.run("UPDATE sync_runs SET trigger = 'open' WHERE user_id = ? AND trigger = 'open-bare'", [adminId]);
    expect((await open(admin)).body.state).toBe("running");
    await idle(admin);
    await age(adminId);
    expect((await open(admin)).body.state).toBe("limited");
    // with the headers there is no count, only the half hour
    expect((await open(admin, FROM_OUTSIDE)).body.state).toBe("running");
  });

  // the scheduled runs of the day are not counted: the hours leave room for them, so the others may be 4 less the hours
  it("with hours 6 and 18 and two scheduled runs, starts the first and second open without headers and limits the third", async () => {
    const { admin, adminId, open, age, clear, addRun, idle, balanceCalls } = await setup();
    await clear(adminId);
    await addRun(adminId, "schedule", 600);
    await addRun(adminId, "schedule", 1200);
    const before = balanceCalls();
    expect((await open(admin)).body.state).toBe("running"); // the first
    await idle(admin);
    await age(adminId); // not fresh any more, still inside the day
    expect((await open(admin)).body.state).toBe("running"); // the second
    await idle(admin);
    await age(adminId);
    expect(balanceCalls()).toBe(before + 4);
    const limited = await open(admin); // the third
    expect(limited.body).toMatchObject({ state: "limited" });
    expect(limited.body.nextAt).toBe("2026-10-09T15:00:00.000Z"); // 18:00 in Helsinki
    expect(balanceCalls()).toBe(before + 4);
  });

  it("counts a manual run as one of the two, and a run with headers or a scheduled one as none", async () => {
    const { admin, adminId, open, clear, addRun } = await setup();
    await clear(adminId);
    await addRun(adminId, "schedule", 600);
    await addRun(adminId, "schedule", 60 * 20);
    await addRun(adminId, "open", 100); // carried headers: not counted
    await addRun(adminId, "manual", 120);
    expect((await open(admin)).body.state).toBe("running"); // one other so far
    await clear(adminId);
    await addRun(adminId, "manual", 120);
    await addRun(adminId, "connect", 150);
    expect((await open(admin)).body.state).toBe("limited"); // two others
    await clear(adminId);
    await addRun(adminId, "manual", 120);
    await addRun(adminId, "open-bare", 25 * 60); // older than a day: not counted
    expect((await open(admin)).body.state).toBe("running");
  });

  it("with four sync hours starts no open without headers, but one with them", async () => {
    const { admin, adminId, open, clear } = await setup({ SYNC_HOURS: "3,6,12,18" });
    await clear(adminId);
    expect((await open(admin)).body.state).toBe("limited");
    expect((await open(admin, FROM_OUTSIDE)).body.state).toBe("running");
  });

  it("with no sync hours allows four opens without headers and limits the fifth", async () => {
    const { admin, adminId, s, open, clear, addRun, idle, balanceCalls } = await setup();
    await s.instance.save({ syncHours: [] });
    await clear(adminId);
    for (const minutes of [400, 300, 200]) await addRun(adminId, "manual", minutes);
    const before = balanceCalls();
    expect((await open(admin)).body.state).toBe("running"); // the fourth
    await idle(admin);
    expect(balanceCalls()).toBe(before + 2);
    await clear(adminId);
    for (const minutes of [400, 300, 200, 100]) await addRun(adminId, "manual", minutes);
    const fifth = await open(admin);
    expect(fifth.body).toMatchObject({ state: "limited", nextAt: null });
    expect(balanceCalls()).toBe(before + 2);
  });

  it("is limited for six hours after the bank answers its rate limit, and the scheduled fetch still runs", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin, adminId, s, bank, open, age, clear, idle, balanceCalls } = await setup();
    await age(adminId);
    for (const uid of ["u-chk", "u-card"]) bank.answers[`GET /accounts/${uid}/balances`] = { status: 429, body: { error: "ASPSP_RATE_LIMIT_EXCEEDED" } };
    expect((await open(admin)).body.state).toBe("running");
    await idle(admin);

    const hours = (Date.parse((await s.settings.get(`bank_rate_limited:${adminId}`))!) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(5.99);
    expect(hours).toBeLessThanOrEqual(6);
    const limited = await open(admin); // the failed fetch is minutes old: limited, not failed
    expect(limited.body).toMatchObject({ state: "limited" });
    expect(limited.body.nextAt).toBe("2026-10-09T15:00:00.000Z"); // 18:00 in Helsinki
    await age(adminId);
    const calls = balanceCalls();
    expect((await open(admin, FROM_OUTSIDE)).body.state).toBe("limited"); // headers do not lift it
    expect(balanceCalls()).toBe(calls);

    bank.answers = {};
    const scheduled = await syncEveryone(s, "schedule");
    expect(scheduled[adminId]?.status).toBe("ok");
    expect(balanceCalls()).toBe(calls + 2);

    // after the six hours an open starts a fetch again
    await s.settings.set(`bank_rate_limited:${adminId}`, new Date(Date.now() - 1000).toISOString());
    await clear(adminId);
    expect((await open(admin)).body.state).toBe("running");
    await idle(admin);
    errors.mockRestore();
  });

  it("counts a bare HTTP 429 as the rate limit, and other errors not", () => {
    expect(new EnableBankingError(429, "{}", "/x").rateLimited).toBe(true);
    expect(new EnableBankingError(500, '{"error":"ASPSP_RATE_LIMIT_EXCEEDED"}', "/x").rateLimited).toBe(true);
    expect(new EnableBankingError(500, '{"error":"ASPSP_ERROR"}', "/x").rateLimited).toBe(false);
    expect(new EnableBankingError(400, "{}", "/x").rateLimited).toBe(false);
  });
});
