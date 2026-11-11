/** A bank answer whose list is not a list fails as a bad answer; a page without the key is an empty page. */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnableBankingClient, EnableBankingError, type KeptPages } from "../src/connectors/enable-banking/client.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const tx = (id: string) => ({
  entry_reference: id,
  transaction_amount: { amount: "1.00", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2024-01-02",
  remittance_information: [id],
});
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
const open = (fetchFn: (u: string | URL | Request) => Promise<Response>, keptPages?: KeptPages) =>
  new EnableBankingClient({ appId: randomUUID(), privateKeyPem: pem, fetch: fetchFn as typeof fetch, keptPages });

describe("balances", () => {
  for (const body of [{}, { balances: "x" }, { balances: { a: 1 } }, { balances: null }]) {
    it(`throws 502 for ${JSON.stringify(body)}`, async () => {
      const err = await open(async () => json(body)).balances("u-1").catch((e) => e);
      expect(err).toBeInstanceOf(EnableBankingError);
      expect(err.status).toBe(502);
    });
  }
  it("returns an array", async () => {
    expect(await open(async () => json({ balances: [] })).balances("u-1")).toEqual([]);
  });
});

describe("transactions", () => {
  for (const bad of ["text", { a: 1 }, null]) {
    it(`throws 502 for transactions ${JSON.stringify(bad)}`, async () => {
      const err = await open(async () => json({ transactions: bad })).transactions("u-1", "2024-01-01").catch((e) => e);
      expect(err).toBeInstanceOf(EnableBankingError);
      expect(err.status).toBe(502);
    });
  }
  it("takes a page without the key as empty", async () => {
    expect(await open(async () => json({})).transactions("u-1", "2024-01-01")).toEqual([]);
  });
  it("keeps the pages read when a later page has a bad list", async () => {
    const calls: string[] = [];
    let bad = true;
    const f = async (input: string | URL | Request) => {
      const key = new URL(String(input)).searchParams.get("continuation_key");
      calls.push(key ?? "first");
      if (!key) return json({ transactions: [tx("a")], continuation_key: "k2" });
      if (bad) {
        bad = false;
        return json({ transactions: "oops" });
      }
      return json({ transactions: [tx("b")] });
    };
    const keptPages: KeptPages = new Map();
    await expect(open(f, keptPages).transactions("u-1", "2024-01-01")).rejects.toBeInstanceOf(EnableBankingError);
    expect(await open(f, keptPages).transactions("u-1", "2024-01-01")).toHaveLength(2);
    expect(calls).toEqual(["first", "k2", "k2"]);
  });
});
