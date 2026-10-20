import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { offeredBanks, testBankApp } from "../src/connectors/enable-banking/app-setup.ts";
import { BANKS, bankById, bankIdForAspsp, offeredFrom } from "../src/connectors/enable-banking/banks.ts";
import { AUTH_HOSTS, checkAuthUrl, EnableBankingClient, EnableBankingError } from "../src/connectors/enable-banking/client.ts";
import { NOW, setupApp, waitFor } from "./helpers.ts";
import { HOLDER, HOLDER_IBAN, mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
/** An instance with its own Enable Banking application. */
const withApp = () => ({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem });

type Bank = ReturnType<typeof mockBank>;
/** What `GET /aspsps` answers from now on. */
const lists = (bank: Bank, names: string[]) => {
  bank.answers["GET /aspsps"] = { status: 200, body: { aspsps: names.map((name) => ({ name, country: "FI", maximum_consent_validity: 180 * 86400 })) } };
};
const listCalls = (bank: Bank) => bank.calls.filter((c) => c.startsWith("GET /aspsps")).length;
const ids = (banks: readonly { id: string }[]) => banks.map((b) => b.id);
const hours = (n: number) => new Date(NOW.getTime() + n * 3600_000);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the bank list", () => {
  it("keeps its ids: a stored id is never renamed", () => {
    expect(ids(BANKS)).toEqual([
      "nordea-fi",
      "op-fi",
      "danske-fi",
      "s-pankki-fi",
      "saastopankki-fi",
      "omasp-fi",
      "pop-fi",
      "aktia-fi",
      "alandsbanken-fi",
      "bank-norwegian-fi",
      "resurs-fi",
      "morrow-fi",
      "eurocard-fi",
      "finnair-plus-fi",
      "sas-eurobonus-fi",
      "holvi-fi",
      "revolut-fi",
    ]);
    expect(BANKS.every((b) => b.country === "FI" && b.psuType === "personal")).toBe(true);
  });

  it("matches a live name without case, spacing, hyphens or accents, and by an older name", () => {
    const offered = offeredFrom(["s pankki", "ALANDSBANKEN", "Komplett Bank", "Finnair Plus MC", "Nordea Business", "POP"].map((name) => ({ name, country: "FI" })));
    expect(offered.map((b) => [b.id, b.aspspName])).toEqual([
      ["s-pankki-fi", "s pankki"],
      ["pop-fi", "POP"],
      ["alandsbanken-fi", "ALANDSBANKEN"],
      ["morrow-fi", "Komplett Bank"],
      ["finnair-plus-fi", "Finnair Plus MC"],
    ]);
    // the list itself keeps its own spelling
    expect(bankById("s-pankki-fi")?.aspspName).toBe("S-Pankki");
  });

  it("leaves out a bank the live list has only for business customers", () => {
    const offered = offeredFrom([
      { name: "Holvi", country: "FI", psu_types: ["business"] },
      { name: "Nordea", country: "FI", psu_types: ["business", "personal"] },
    ]);
    expect(ids(offered)).toEqual(["nordea-fi"]);
  });

  it("names the bank of a consent by id, and no other name", () => {
    expect(bankIdForAspsp("Oma Säästöpankki")).toBe("omasp-fi");
    expect(bankIdForAspsp("säästöpankki")).toBe("saastopankki-fi");
    for (const other of ["Nordea Business", "POP Pankki Oyj", "", null, 5]) expect(bankIdForAspsp(other), String(other)).toBeNull();
  });
});

describe("the banks the server offers", () => {
  it("are the ones the application's live list has, named as it writes them, for 24 hours", async () => {
    const bank = mockBank();
    // S-Pankki in another case, POP Pankki with other spacing, OP missing
    lists(bank, ["Nordea", "s-PANKKI", "POP  Pankki", "Mock ASPSP"]);
    let now = NOW;
    const { s } = await setupApp(withApp(), bank.fetchMock, { now: () => now });

    const offered = await offeredBanks(s);
    expect(offered.map((b) => [b.id, b.aspspName])).toEqual([
      ["nordea-fi", "Nordea"],
      ["s-pankki-fi", "s-PANKKI"],
      ["pop-fi", "POP  Pankki"],
    ]);

    lists(bank, ["Nordea", "OP"]);
    now = hours(23);
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi", "s-pankki-fi", "pop-fi"]);
    expect(listCalls(bank)).toBe(1);
    now = hours(25);
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi", "op-fi"]);
    expect(listCalls(bank)).toBe(2);
  });

  it("are what /api/meta lists, with the name shown in the app", async () => {
    const bank = mockBank();
    lists(bank, ["Nordea", "s-PANKKI"]);
    const { admin, member } = await setupApp(withApp(), bank.fetchMock);
    const listed = [
      { id: "nordea-fi", name: "Nordea", country: "FI" },
      { id: "s-pankki-fi", name: "S-Pankki", country: "FI" },
    ];
    expect((await admin.call("GET", "/api/meta")).body.bank.banks).toEqual(listed);
    expect((await (await member("eero")).call("GET", "/api/meta")).body.bank.banks).toEqual(listed);
    expect(listCalls(bank)).toBe(1);
  });

  it("are Nordea alone with no application, without a call", async () => {
    const bank = mockBank();
    lists(bank, ["Nordea", "OP"]);
    const { s } = await setupApp({}, bank.fetchMock);
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi"]);
    expect(bank.calls).toEqual([]);
  });

  it("are Nordea alone when the call fails, and the call is tried again ten minutes later", async () => {
    const bank = mockBank();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    bank.answers["GET /aspsps"] = { status: 500, body: { error: "INTERNAL" } };
    let now = NOW;
    const { s } = await setupApp(withApp(), bank.fetchMock, { now: () => now });

    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi"]);
    expect(logged.mock.calls.flat().join(" ")).toContain("bank list: Enable Banking 500");
    lists(bank, ["Nordea", "OP"]);
    now = new Date(NOW.getTime() + 9 * 60_000);
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi"]);
    expect(listCalls(bank)).toBe(1);
    now = new Date(NOW.getTime() + 11 * 60_000);
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi", "op-fi"]);
  });

  it("do not hold a page load when Enable Banking is slow: Nordea alone now, the answer for the next load", async () => {
    const bank = mockBank();
    lists(bank, ["Nordea", "OP"]);
    let answer!: () => void;
    const slow = new Promise<void>((done) => {
      answer = done;
    });
    const fetchMock: typeof fetch = async (input, init) => {
      if (String(input).includes("/aspsps")) await slow;
      return bank.fetchMock(input, init);
    };
    const { s } = await setupApp(withApp(), fetchMock);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const first = offeredBanks(s);
    for (let i = 0; i < 1000 && vi.getTimerCount() === 0; i++) await new Promise((r) => setImmediate(r));
    vi.advanceTimersByTime(3000);
    expect(ids(await first)).toEqual(["nordea-fi"]);
    vi.useRealTimers();

    answer();
    await waitFor(async () => (await offeredBanks(s)).length === 2);
    expect(listCalls(bank)).toBe(1);
  });

  it("keep the list of the day before when the refresh after 24 hours fails, and ask again after ten minutes", async () => {
    const bank = mockBank();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    lists(bank, ["Nordea", "OP"]);
    let now = NOW;
    const { s } = await setupApp(withApp(), bank.fetchMock, { now: () => now });
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi", "op-fi"]);

    bank.answers["GET /aspsps"] = { status: 500, body: { error: "INTERNAL" } };
    now = hours(25);
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi", "op-fi"]);
    expect(logged.mock.calls.flat().join(" ")).toContain("bank list: Enable Banking 500");
    expect(listCalls(bank)).toBe(2);

    // the failed day is not a fresh answer: no call for ten minutes, one call after
    lists(bank, ["Nordea", "Aktia"]);
    now = new Date(hours(25).getTime() + 5 * 60_000);
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi", "op-fi"]);
    expect(listCalls(bank)).toBe(2);
    now = new Date(hours(25).getTime() + 11 * 60_000);
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi", "aktia-fi"]);
    expect(listCalls(bank)).toBe(3);
  });

  it("keep the list of the day before while the refresh after 24 hours is slow, and use its answer next", async () => {
    const bank = mockBank();
    lists(bank, ["Nordea", "OP"]);
    let hold: Promise<void> | null = null;
    const fetchMock: typeof fetch = async (input, init) => {
      if (hold && String(input).includes("/aspsps")) await hold;
      return bank.fetchMock(input, init);
    };
    let now = NOW;
    const { s } = await setupApp(withApp(), fetchMock, { now: () => now });
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi", "op-fi"]);

    let answer!: () => void;
    hold = new Promise<void>((done) => {
      answer = done;
    });
    lists(bank, ["Nordea", "Aktia"]);
    now = hours(25);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const load = offeredBanks(s);
    for (let i = 0; i < 1000 && vi.getTimerCount() === 0; i++) await new Promise((r) => setImmediate(r));
    vi.advanceTimersByTime(3000);
    expect(ids(await load)).toEqual(["nordea-fi", "op-fi"]);
    vi.useRealTimers();

    answer();
    await waitFor(async () => ids(await offeredBanks(s)).includes("aktia-fi"));
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi", "aktia-fi"]);
    expect(listCalls(bank)).toBe(2);
  });

  it("do not take an answer without a list for an empty list: a failed call, Nordea alone, tried again", async () => {
    const bank = mockBank();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    bank.answers["GET /aspsps"] = { status: 200, body: {} };
    let now = NOW;
    const { s } = await setupApp(withApp(), bank.fetchMock, { now: () => now });
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi"]);
    expect(logged.mock.calls.flat().join(" ")).toContain("bank list: Enable Banking 502");

    lists(bank, ["Nordea", "OP"]);
    now = new Date(NOW.getTime() + 11 * 60_000);
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi", "op-fi"]);
  });

  it("listAspsps throws on a 200 answer without a list", async () => {
    const answer = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const client = (body: unknown) => new EnableBankingClient({ appId: randomUUID(), privateKeyPem: pem, fetch: answer(body) });
    for (const body of [{}, { aspsps: null }, { aspsps: "Nordea" }, []]) {
      await expect(client(body).listAspsps("FI"), JSON.stringify(body)).rejects.toBeInstanceOf(EnableBankingError);
    }
    await expect(client({ aspsps: [] }).listAspsps("FI")).resolves.toEqual([]);
    await expect(client({ aspsps: [{ name: "OP" }, { country: "FI" }] }).listAspsps("FI")).resolves.toEqual([{ name: "OP" }]);
  });

  it("are Nordea alone while the application is not active, and the list of the setup test once it is", async () => {
    const bank = mockBank();
    lists(bank, ["Nordea", "Danske Bank"]);
    bank.answers["GET /application"] = { status: 200, body: { active: false } };
    const { s } = await setupApp(withApp(), bank.fetchMock);

    expect((await testBankApp(s)).active).toBe(false);
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi"]);
    expect(listCalls(bank)).toBe(0);

    bank.answers["GET /application"] = { status: 200, body: { active: true } };
    expect(await testBankApp(s)).toMatchObject({ verified: true, active: true });
    expect(ids(await offeredBanks(s))).toEqual(["nordea-fi", "danske-fi"]);
    // the test's own answer is the list: no second call
    expect(listCalls(bank)).toBe(1);
  });

  it("the setup test passes with any bank of the list, and says so when the application has none", async () => {
    const bank = mockBank();
    lists(bank, ["OP"]);
    const { s } = await setupApp(withApp(), bank.fetchMock);
    expect(await testBankApp(s)).toMatchObject({ verified: true, message: "Yhteys toimii." });
    lists(bank, ["Mock ASPSP"]);
    const none = await testBankApp(s);
    expect(none.verified).toBe(false);
    expect(none.message).toContain("pankkilistalla");
    // a live list without any known bank offers none
    expect(await offeredBanks(s)).toEqual([]);
  });
});

describe("starting a bank", () => {
  it("takes an id of the list and sends the name the live list writes", async () => {
    const bank = mockBank();
    lists(bank, ["Nordea", "s-PANKKI"]);
    const sent: { aspsp: unknown; psu_type: unknown }[] = [];
    const fetchMock: typeof fetch = (input, init) => {
      if (String(input).endsWith("/auth")) sent.push(JSON.parse(String(init?.body)));
      return bank.fetchMock(input, init);
    };
    const { admin } = await setupApp(withApp(), fetchMock);

    expect((await admin.call("POST", "/api/connections/start", { bank: "s-pankki-fi" })).status).toBe(200);
    expect(sent[0]).toMatchObject({ aspsp: { name: "s-PANKKI", country: "FI" }, psu_type: "personal" });

    // a bank of the list that the application's live list lacks
    const missing = await admin.call("POST", "/api/connections/start", { bank: "op-fi" });
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain("ei löytynyt Enable Bankingista");
    // a name is not an id
    for (const id of ["s-PANKKI", "S-Pankki", "evil"]) expect((await admin.call("POST", "/api/connections/start", { bank: id })).status, id).toBe(400);
    expect(sent).toHaveLength(1);
  });
});

describe("consent hosts", () => {
  it("are plain host names of the banks, Enable Banking's own first", () => {
    expect(AUTH_HOSTS[0]).toBe("enablebanking.com");
    expect(new Set(AUTH_HOSTS).size).toBe(AUTH_HOSTS.length);
    for (const host of AUTH_HOSTS) expect(host, host).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    for (const bank of BANKS) for (const host of bank.authHosts) expect(AUTH_HOSTS, bank.id).toContain(host);
  });

  it("pass a consent URL on each listed host and refuse a look-alike", () => {
    for (const host of AUTH_HOSTS) {
      expect(checkAuthUrl(`https://${host}/consent?x=1`), host).toBe(`https://${host}/consent?x=1`);
      expect(checkAuthUrl(`https://login.${host}/consent`), host).toBe(`https://login.${host}/consent`);
      const alike = [
        `http://${host}/consent`,
        `https://${host}.example.com/consent`,
        `https://evil${host}/consent`,
        `https://evil-${host}/consent`,
        `https://example.com/${host}`,
        `https://${host}@example.com/consent`,
        `https://example.com/?next=https://${host}/`,
        // the rule every address from an answer is held to (platform/outbound.ts): the default port, no empty label
        `https://${host}:8443/consent`,
        `https://login..${host}/consent`,
      ];
      for (const bad of alike) expect(() => checkAuthUrl(bad), bad).toThrow();
    }
  });

  it("refuse hosts that only look like a bank's", () => {
    // shop.fi ends with op.fi, spendwise.fi is listed only as my.spendwise.fi, sebkort.com and revolut.com could not be confirmed
    for (const bad of ["https://shop.fi/", "https://op.fi.evil.fi/", "https://spendwise.fi/", "https://sebkort.com/", "https://revolut.com/", "https://s-pankki.fi.example/", "https://nordea.fi:443@evil.fi/"]) {
      expect(() => checkAuthUrl(bad), bad).toThrow();
    }
  });
});

describe("linking an account", () => {
  it("writes nothing the bank sent to the log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const bank = mockBank();
    const app = await setupApp(withApp(), bank.fetchMock);
    await app.admin.call("POST", "/api/connections/start", {});
    await app.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    await waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.some((r: { status: string }) => r.status !== "running"));
    const lines = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(lines).not.toContain("bank link");
    expect(lines).not.toContain(HOLDER);
    expect(lines).not.toContain(HOLDER_IBAN);
  });
});
