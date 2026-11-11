/** A failed page of a transactions answer keeps the pages already read: the next try goes on from the failed page. */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnableBankingClient, type KeptPages } from "../src/connectors/enable-banking/client.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const tx = (id: string) => ({
  entry_reference: id,
  transaction_amount: { amount: "1.00", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2024-01-02",
  remittance_information: [id],
});

describe("transactions with a failing page", () => {
  it("does not read the pages again that were read before the failure", async () => {
    const calls: string[] = [];
    let failTwo = true;
    const fetchFn = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const key = url.searchParams.get("continuation_key");
      calls.push(key ?? "first");
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
      if (!key) return json({ transactions: [tx("a")], continuation_key: "k2" });
      if (key === "k2") {
        if (failTwo) {
          failTwo = false;
          return json({ error: "down" }, 503);
        }
        return json({ transactions: [tx("b")], continuation_key: "k3" });
      }
      return json({ transactions: [tx("c")] });
    };
    // the next sync opens a new client; the user's store of kept pages is what it shares
    const keptPages: KeptPages = new Map();
    const open = () => new EnableBankingClient({ appId: randomUUID(), privateKeyPem: pem, fetch: fetchFn as typeof fetch, keptPages });
    await expect(open().transactions("u-1", "2024-01-01")).rejects.toThrow();
    const rows = await open().transactions("u-1", "2024-01-01");
    expect(rows).toHaveLength(3);
    expect(calls).toEqual(["first", "k2", "k2", "k3"]);
  });
});
