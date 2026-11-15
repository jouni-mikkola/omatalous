/**
 * A bank that gave no answer is told as the bank's outage, and a removal while it is out leaves the consent as it was.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { enableBanking, removeConnection } from "../src/connectors/enable-banking/connector.ts";
import { EnableBankingError } from "../src/connectors/enable-banking/client.ts";
import { UpstreamError } from "../src/platform/errors.ts";
import { mockBank } from "./mock-bank.ts";
import { setupApp, waitFor } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const WORDS = "pankki ei vastannut oikein, yritä myöhemmin uudelleen";
const REFUSED = "Pankki ei vastannut, yhteyttä ei poistettu. Yritä uudelleen.";

type Admin = Awaited<ReturnType<typeof setupApp>>["admin"];

async function connect(admin: Admin, bank: ReturnType<typeof mockBank>): Promise<string> {
  await admin.call("POST", "/api/connections/start", {});
  const done = await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` });
  expect(done.status).toBe(200);
  await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  return done.body.connectionId;
}

const status = async (admin: Admin, id: string) => ((await admin.call("GET", "/api/meta")).body.connections.find((c: { id: string }) => c.id === id) as { status: string }).status;

describe("classify", () => {
  it("an UpstreamError that is no EnableBankingError is the bank not answering, not rate limited", () => {
    expect(enableBanking.sync!.classify(new UpstreamError("Enable Banking fetch failed ECONNREFUSED", "x"))).toEqual({ kind: "upstream", message: WORDS, rateLimited: false });
    expect(enableBanking.sync!.classify(new Error("other"))).toBeNull();
    expect(enableBanking.sync!.classify(new EnableBankingError(429, "", "/x"))).toMatchObject({ kind: "upstream", rateLimited: true });
  });

  it("a failed fetch of an account puts the words on its row", async () => {
    const bank = mockBank();
    let down = false;
    const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
      if (down && String(input).includes("/transactions")) throw new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ECONNREFUSED" }) });
      return bank.fetchMock(input, init);
    }) as typeof fetch;
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, fetchMock);
    await connect(admin, bank);
    down = true;
    const sync = await admin.call("POST", "/api/sync");
    expect((sync.body.messages as string[]).some((m) => m.endsWith(`${WORDS}.`))).toBe(true);
  });
});

describe("removeConnection", () => {
  async function remove(session: (input: string) => Response | Error) {
    const bank = mockBank();
    const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE" && String(input).includes("/sessions/")) {
        const r = session(String(input));
        if (r instanceof Error) throw r;
        return r;
      }
      return bank.fetchMock(input, init);
    }) as typeof fetch;
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, fetchMock);
    const id = await connect(admin, bank);
    const res = await admin.call("DELETE", `/api/connections/${id}`);
    return { res, state: await status(admin, id) };
  }
  const answer = (code: number, body: unknown = {}) => new Response(JSON.stringify(body), { status: code });

  it.each([
    ["503", () => answer(503)],
    ["429", () => answer(429)],
    ["no answer", () => new TypeError("fetch failed")],
  ])("a deleteSession with %s is refused and the connection stays active", async (_n, session) => {
    const { res, state } = await remove(session);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain(REFUSED);
    expect(state).toBe("active");
  });

  it.each([
    ["404", () => answer(404)],
    ["consentExpired", () => answer(401, { error: "CLOSED_SESSION" })],
    ["401", () => answer(401, { error: "INVALID_JWT" })],
    ["403", () => answer(403, { error: "FORBIDDEN" })],
  ])("a deleteSession with %s still sets it revoked", async (_n, session) => {
    const { res, state } = await remove(session);
    expect(res.status).toBe(200);
    expect(state).toBe("revoked");
  });

  it("missing credentials still set it revoked", async () => {
    const bank = mockBank();
    const { admin, s, adminId } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const id = await connect(admin, bank);
    const repo = s.finance(adminId);
    const noCreds = { ...s, config: { ...s.config, bank: { ...s.config.bank } }, settings: undefined } as unknown as typeof s;
    const { UserError } = await import("../src/platform/errors.ts");
    const creds = await import("../src/connectors/enable-banking/credentials.ts");
    const spy = vi.spyOn(creds, "clientFor").mockRejectedValue(new UserError("ei käytössä"));
    try {
      await removeConnection(noCreds, repo, id);
    } finally {
      spy.mockRestore();
    }
    expect((await repo.listConnections()).find((c) => c.id === id)?.status).toBe("revoked");
  });
});
