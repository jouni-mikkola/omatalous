/** The time of transfer pairing: thousands of identical weekly moves in well under a second. It runs in the perf project (docs/DEVELOPMENT.md). */
import { describe, expect, it } from "vitest";
import type { Account } from "../src/types.ts";
import { detectTransfers } from "../src/transfers.ts";
import { bestOfSync } from "../../../tools/lib/timing.ts";
import { weeklyMoves } from "./transfers-kit.ts";

const accounts: Account[] = [
  { id: "a", name: "Käyttötili", iban: "FI0000000000000001", currency: "EUR", type: "checking" },
  { id: "b", name: "Säästötili", iban: "FI0000000000000002", currency: "EUR", type: "savings" },
];

describe("detectTransfers pairing window", () => {
  it("pairs thousands of identical weekly moves in well under a second", () => {
    const txs = weeklyMoves(4000);
    const { ms, result: found } = bestOfSync(3, () => detectTransfers(txs, accounts));
    expect(found.size).toBe(8000);
    expect(ms).toBeLessThan(1000);
  });
});
