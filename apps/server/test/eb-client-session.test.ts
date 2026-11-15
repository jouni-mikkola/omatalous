/** A session or authorization answer without its ids is a failed call (502), never a TypeError or `/sessions/undefined`. */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { codeWasSpent, EnableBankingClient, EnableBankingError } from "../src/connectors/enable-banking/client.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function clientAnswering(sessions: unknown, calls: string[] = [], auth: unknown = {}) {
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const line = `${init?.method} ${new URL(String(input)).pathname}`;
    calls.push(line);
    if (line === "POST /sessions") return new Response(JSON.stringify(sessions));
    if (line === "POST /auth") return new Response(JSON.stringify(auth));
    return new Response("{}");
  }) as typeof fetch;
  return new EnableBankingClient({ appId: randomUUID(), privateKeyPem: pem, fetch: fetchFn });
}

const fail = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

describe("createSession answer", () => {
  it("withdraws the session and throws 502 when accounts is not an array", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const calls: string[] = [];
    const err = await fail(clientAnswering({ session_id: "s-1" }, calls).createSession("abc"));
    expect(err).toBeInstanceOf(EnableBankingError);
    expect((err as EnableBankingError).status).toBe(502);
    expect((err as Error).message).toContain("/sessions");
    expect(calls).toContain("DELETE /sessions/s-1");
    expect(codeWasSpent(err)).toBe(true);
    log.mockRestore();
  });

  it.each([{ accounts: [] }, { session_id: "", accounts: [] }, { session_id: 5, accounts: [] }])(
    "throws 502 without any delete when session_id is bad: %j",
    async (answer) => {
      const calls: string[] = [];
      const err = await fail(clientAnswering(answer, calls).createSession("abc"));
      expect(err).toBeInstanceOf(EnableBankingError);
      expect((err as EnableBankingError).status).toBe(502);
      expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false);
      expect(codeWasSpent(err)).toBe(false);
    },
  );
});

describe("startAuthorization answer", () => {
  it.each([{}, { authorization_id: "" }, { authorization_id: 3 }])("throws 502 when authorization_id is bad: %j", async (extra) => {
    const client = clientAnswering({}, [], { url: "https://enablebanking.com/auth", ...extra });
    const err = await fail(
      client.startAuthorization({ aspspName: "B", country: "FI", redirectUrl: "https://x.fi/cb", state: "s", validUntil: new Date(), psuType: "personal" }),
    );
    expect(err).toBeInstanceOf(EnableBankingError);
    expect((err as EnableBankingError).status).toBe(502);
  });
});
