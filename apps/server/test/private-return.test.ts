import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { redirectModeOf, redirectUrlFor } from "../src/services/instance.ts";
import { mockBank } from "./mock-bank.ts";
import { setupApp, waitFor } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const NAME = "https://koti.home.arpa";

describe("a private https name as the return address", () => {
  it("is the own mode with the callback on that name, whatever the stored mode", () => {
    const base = { appBaseUrl: NAME, setupDone: true, redirectMode: null };
    for (const state of [base, { ...base, redirectMode: "relay" as const }, { ...base, redirectMode: "paste" as const }]) {
      expect(redirectModeOf(state)).toBe("own");
      expect(redirectUrlFor(state, null)).toBe(`${NAME}/api/connections/callback`);
    }
  });

  it("starts a link with that URL and a plain state, and the callback completes it from code and state", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem, APP_BASE_URL: NAME }, bank.fetchMock);
    expect((await admin.call("POST", "/api/connections/start", {})).status).toBe(200);
    expect(bank.redirectUrl).toBe(`${NAME}/api/connections/callback`);
    // no address of the household travels in a plain state
    expect(bank.state).not.toContain(".");

    const back = await admin.call("GET", `/api/connections/callback?code=abc&state=${bank.state}`);
    expect(back.status).toBe(302);
    expect(back.res.headers.get("location")).not.toMatch(/error=/);
    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
    expect((await admin.call("GET", "/api/meta")).body.connections).toHaveLength(1);
  });
});
