/**
 * When the bank made a session but one account detail fails, the link fails for the user (they see the bank link
 * did not work and can try again). The consent must not stay open at the bank, so the session is deleted there.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { codeWasSpent, EnableBankingClient } from "../src/connectors/enable-banking/client.ts";
import { mockBank } from "./mock-bank.ts";
import { setupApp } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("createSession when an account detail fails", () => {
  it("withdraws the consent at the bank and still fails", async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const line = `${init?.method} ${new URL(String(input)).pathname}`;
      calls.push(line);
      if (line === "POST /sessions") {
        return new Response(JSON.stringify({ session_id: "s-1", accounts: ["a-1", "a-2"], aspsp: { name: "B", country: "FI" }, access: { valid_until: "2027-01-01T00:00:00Z" } }));
      }
      if (line === "GET /accounts/a-1/details") return new Response(JSON.stringify({}));
      if (line === "GET /accounts/a-2/details") return new Response(JSON.stringify({ error: "BUSY" }), { status: 503 });
      return new Response("{}");
    }) as typeof fetch;
    const client = new EnableBankingClient({ appId: randomUUID(), privateKeyPem: pem, fetch: fetchFn });
    await expect(client.createSession("abc")).rejects.toThrow();
    expect(calls).toContain("DELETE /sessions/s-1");
  });

  it("logs a withdrawal that fails and still throws the original error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const line = `${init?.method} ${new URL(String(input)).pathname}`;
      if (line === "POST /sessions") return new Response(JSON.stringify({ session_id: "s-1", accounts: ["a-1"], aspsp: { name: "B", country: "FI" }, access: { valid_until: "2027-01-01T00:00:00Z" } }));
      if (line === "GET /accounts/a-1/details") return new Response("{}", { status: 503 });
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    const client = new EnableBankingClient({ appId: randomUUID(), privateKeyPem: pem, fetch: fetchFn });
    const err = await client.createSession("abc").then(() => null, (e: unknown) => e);
    expect((err as Error).message).toContain("/accounts/a-1/details");
    expect(codeWasSpent(err)).toBe(true);
    expect(log.mock.calls.some((c) => String(c[0]).includes("withdraw consent s-1"))).toBe(true);
    log.mockRestore();
  });

  it("does not restore the link state when the code was spent and the session withdrawn", async () => {
    const bank = mockBank();
    const fetchMock = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/sessions")) {
        return Promise.resolve(new Response(JSON.stringify({ session_id: "s-9", accounts: ["u-x"], aspsp: { name: "Nordea", country: "FI" }, access: { valid_until: "2027-04-06T00:00:00Z" } })));
      }
      if (url.endsWith("/accounts/u-x/details")) return Promise.resolve(new Response("{}", { status: 503 }));
      return bank.fetchMock(input, init);
    }) as typeof fetch;
    const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, fetchMock);
    await app.admin.call("POST", "/api/connections/start", {});
    const complete = () => app.admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` });
    expect((await complete()).status).not.toBe(200);
    // the state is consumed: a second try with the same address is not accepted
    expect((await complete()).status).not.toBe(200);
    expect(bank.calls.some((c) => c.startsWith("DELETE /sessions/s-9"))).toBe(true);
  });
});
