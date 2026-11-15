/**
 * A running fetch says how many rows it has brought so far: the run's record carries the count while the fetch runs, and
 * `GET /api/meta` gives it to the page as `lastSync`. Made-up data.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("the rows a running fetch has brought so far", () => {
  it("are read from the run while the bank still answers for the second account, and the run ends with the whole count", async () => {
    const bank = mockBank();
    // the bank answers the rows of the first account asked and holds the second until the test lets it go
    let release: () => void = () => {};
    const held = new Promise<void>((done) => (release = done));
    const asked = new Set<string>();
    const holding = (async (input: string | URL | Request, init?: RequestInit) => {
      const account = /\/accounts\/([\w-]+)\/transactions/.exec(String(input))?.[1];
      if (account) {
        asked.add(account);
        if (asked.size > 1) await held;
      }
      return bank.fetchMock(input, init);
    }) as typeof fetch;
    const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, holding);
    await app.admin.call("POST", "/api/connections/start", {});
    await app.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    const lastSync = async () => (await app.admin.call("GET", "/api/meta")).body.lastSync as { status: string; fetched: number; finishedAt: string | null };

    try {
      await waitFor(async () => asked.size > 1 && (await lastSync()).fetched > 0);
      const running = await lastSync();
      // the first account's rows are counted, the second account's are still at the bank; the run has no end time yet
      expect(running.status).toBe("running");
      expect(running.finishedAt).toBeNull();
      const [first] = [...asked];
      const stored = await app.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.external_id = ?", [first!]);
      expect(running.fetched).toBe(Number(stored[0]!.n));
      expect(running.fetched).toBeGreaterThan(0);

      release();
      await waitFor(async () => (await lastSync()).status !== "running");
      const ended = await lastSync();
      expect(ended.status).toBe("ok");
      expect(ended.fetched).toBeGreaterThan(running.fetched);
      expect(ended.finishedAt).not.toBeNull();
    } finally {
      release();
    }
  });
});
