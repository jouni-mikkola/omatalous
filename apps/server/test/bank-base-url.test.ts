import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offeredBanks, testBankApp } from "../src/connectors/enable-banking/app-setup.ts";
import { loadConfig } from "../src/platform/config.ts";
import { setupApp } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
/** An instance with a bank application of its own, so every call to the bank can be made. */
const withApp = () => ({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem });

// the stand-in answers nothing useful: only the address of each call is read, and the failures it causes are logged
beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => void vi.restoreAllMocks());

describe("EB_API_URL: where the bank's API is", () => {
  it("is not set: the config holds no address", () => {
    expect(loadConfig({}).bank.apiUrl).toBeUndefined();
    expect(loadConfig({ EB_API_URL: "  " }).bank.apiUrl).toBeUndefined();
  });

  it.each([
    ["http://127.0.0.1:8123", "http://127.0.0.1:8123"],
    ["https://localhost", "https://localhost"],
    ["http://[::1]:9", "http://[::1]:9"],
    [" http://LOCALHOST:9/ ", "http://localhost:9"],
  ])("%s is accepted, as an address without a path", (value, expected) => {
    expect(loadConfig({ EB_API_URL: value }).bank.apiUrl).toBe(expected);
  });

  it.each([
    "https://api.enablebanking.com",
    "http://192.168.1.10:8080",
    "http://0.0.0.0:8080",
    "http://127.0.0.1.example.com",
    "http://localhost.example.com:8080",
    "http://example.com/127.0.0.1",
    "http://user@127.0.0.1:8080",
    "http://[::2]:8080",
    "ftp://127.0.0.1",
    "127.0.0.1:8080",
  ])("%s stops the start with one line", (value) => {
    expect(() => loadConfig({ EB_API_URL: value })).toThrow(/^EB_API_URL must be an http or https address on this machine .*$/);
  });

  // every place that makes a client for the bank: the test of the shared key, the bank list of the picker, a link
  const callers = {
    "the test of the shared key": (s: Parameters<typeof testBankApp>[0]) => testBankApp(s),
    "the bank list of the picker": (s: Parameters<typeof offeredBanks>[0]) => offeredBanks(s),
    "starting a link": async (_s: unknown, admin: { call: (method: string, path: string, body?: unknown) => Promise<unknown> }) => {
      await admin.call("POST", "/api/connections/start", { bank: "nordea-fi" });
    },
  };
  it.each(Object.entries(callers))("%s calls Enable Banking's own address, and with the setting the address given", async (_name, call) => {
    for (const [env, origin] of [
      [{}, "https://api.enablebanking.com"],
      [{ EB_API_URL: "http://127.0.0.1:9" }, "http://127.0.0.1:9"],
    ] as const) {
      const urls: string[] = [];
      const fetchMock = (async (input: string | URL | Request) => {
        urls.push(String(input));
        return new Response("{}", { status: 200 });
      }) as typeof fetch;
      const { s, admin } = await setupApp({ ...withApp(), ...env }, fetchMock);
      await call(s, admin);
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.filter((u) => !u.startsWith(`${origin}/`))).toEqual([]);
    }
  });

  it("cannot be set from the browser: the instance settings refuse it and do not list it", async () => {
    const { admin } = await setupApp({ EB_API_URL: "http://127.0.0.1:9" });
    expect((await admin.call("PUT", "/api/admin/instance", { apiUrl: "http://127.0.0.1:1" })).status).toBe(400);
    expect(JSON.stringify((await admin.call("GET", "/api/admin/instance")).body)).not.toMatch(/apiUrl|127\.0\.0\.1:9/);
  });
});
