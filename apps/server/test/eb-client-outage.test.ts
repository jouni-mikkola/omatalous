/**
 * A call to Enable Banking that gets no answer (no network, the timeout) or one over the size cap is an outage of the
 * bank's side: an UpstreamError, which the app answers with 502. Its log line names the path and a cause code only.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnableBankingClient } from "../src/connectors/enable-banking/client.ts";
import { UpstreamError } from "../src/platform/errors.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PATH = "/accounts/u-1/balances";
const SECRET = "FI00 1234 salainen saldo";

/** What `request` throws for a balances call through `fetchFn`. */
async function failure(fetchFn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): Promise<unknown> {
  const client = new EnableBankingClient({ appId: randomUUID(), privateKeyPem: pem, fetch: fetchFn as typeof fetch });
  return client.balances("u-1").then(
    () => null,
    (err: unknown) => err,
  );
}

function expectOutage(err: unknown, code: string): void {
  expect(err).toBeInstanceOf(UpstreamError);
  const outage = err as UpstreamError;
  expect(outage.message).toContain(PATH);
  expect(outage.message).toContain(code);
  const shown = `${outage.message} ${outage.userMessage} ${String(outage.stack)}`;
  for (const part of ["FI00", "1234", "salainen", "saldo"]) expect(shown).not.toContain(part);
}

describe("Enable Banking gives no usable answer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a fetch that rejects is an UpstreamError with the path and the cause's code", async () => {
    const err = await failure(async () => {
      throw new TypeError(`fetch failed for ${SECRET}`, { cause: Object.assign(new Error(SECRET), { code: "ECONNREFUSED" }) });
    });
    expectOutage(err, "ECONNREFUSED");
  });

  it("a rejection without a code is named by the kind of error, never by its text", async () => {
    const err = await failure(async () => {
      throw Object.assign(new TypeError(SECRET), { code: `${SECRET} not a code` });
    });
    expectOutage(err, "TypeError");
  });

  it("a fetch that times out is an UpstreamError with the path and TimeoutError", async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(10));
    const err = await failure(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init!.signal!;
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    expectOutage(err, "TimeoutError");
  });

  it("an answer over the cap is an UpstreamError with the path and TOO_LARGE", async () => {
    const err = await failure(async () => new Response(SECRET, { status: 200, headers: { "content-length": String(50 * 1024 * 1024) } }));
    expectOutage(err, "TOO_LARGE");
  });
});
