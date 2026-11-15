import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mockBank } from "./mock-bank.ts";
import { setupApp } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

async function started(down: { on: boolean }) {
  const bank = mockBank();
  const fetchMock = ((input: string | URL | Request, init?: RequestInit) => {
    if (down.on && String(input).endsWith("/sessions") && init?.method === "POST") return Promise.reject(new TypeError("fetch failed"));
    return bank.fetchMock(input, init);
  }) as typeof fetch;
  const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, fetchMock);
  await app.admin.call("POST", "/api/connections/start", {});
  const complete = (who = app.admin) => who.call("POST", "/api/connections/complete", { url: `?code=abc&state=${bank.state}` });
  return { bank, app, complete };
}

describe("a failed bank return", () => {
  for (const status of [503, 429]) {
    it(`a ${status} at createSession leaves the state usable`, async () => {
      const { bank, complete } = await started({ on: false });
      bank.answers["POST /sessions"] = { status, body: { error: "BUSY" } };
      expect((await complete()).status).not.toBe(200);
      delete bank.answers["POST /sessions"];
      expect((await complete()).status).toBe(200);
    });
  }

  it("no answer at createSession leaves the state usable", async () => {
    const down = { on: true };
    const { complete } = await started(down);
    expect((await complete()).status).not.toBe(200);
    down.on = false;
    expect((await complete()).status).toBe(200);
  });

  it("a 4xx refusal consumes the state", async () => {
    const { bank, complete } = await started({ on: false });
    bank.answers["POST /sessions"] = { status: 422, body: { error: "NOPE" } };
    expect((await complete()).status).not.toBe(200);
    delete bank.answers["POST /sessions"];
    const again = await complete();
    expect(again.status).not.toBe(200);
  });

  it("a state of another user is consumed", async () => {
    const { app, complete } = await started({ on: false });
    const other = await app.member("toinen");
    expect((await complete(other)).status).not.toBe(200);
    expect((await complete()).status).not.toBe(200);
  });

  it("the state is used once on success", async () => {
    const { complete } = await started({ on: false });
    expect((await complete()).status).toBe(200);
    expect((await complete()).status).not.toBe(200);
  });
});
