import { describe, expect, it } from "vitest";
import { addDays } from "../src/dates.ts";
import { detectTransfers } from "../src/transfers.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { detectTransfersReference } from "./transfers-reference.ts";
import { bestOfSync } from "../../../tools/lib/timing.ts";

const accounts: Account[] = [
  { id: "a", name: "Käyttötili", iban: "FI0000000000000001", currency: "EUR", type: "checking" },
  { id: "b", name: "Säästötili", iban: "FI0000000000000002", currency: "EUR", type: "savings" },
  { id: "c", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" },
  { id: "d", name: "Laina", iban: "FI0000000000000004", currency: "EUR", type: "loan" },
];

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("detectTransfers pairing window", () => {
  it("finds the same transfers as the all-pairs version on random rows, in any input order", () => {
    let paired = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
      const txs: Transaction[] = [];
      // few amounts and a short span make ties, equal gaps and busy windows common
      const n = 40 + Math.floor(r() * 120);
      for (let i = 0; i < n; i++) {
        const amount = pick([1000, 2500, 2500, 5000, 12345]) * (r() < 0.5 ? -1 : 1);
        txs.push(
          tx({
            id: `s${seed}-${i}`,
            accountId: pick(["a", "a", "b", "c", "d"]),
            bookingDate: addDays("2026-01-01", Math.floor(r() * 25)),
            amountCents: amount,
            counterpartyIban: pick([null, null, null, "FI0000000000000001", "FI0000000000000002", "FI9900000000000009"]),
            category: pick(["other", "income", "card_bill", "p2p", "savings", "groceries"]),
            categorySource: pick(["default", "default", "rule", "mcc", "user"] as const),
          }),
        );
      }
      const shuffled = [...txs].sort(() => r() - 0.5);
      for (const input of [txs, shuffled]) {
        const expected = detectTransfersReference(input, accounts);
        expect([...detectTransfers(input, accounts)].sort()).toEqual([...expected].sort());
        paired += expected.size;
        const noFallback = { issuerFallback: false, exclude: new Set(input.filter((_, i) => i % 11 === 0).map((t) => t.id)) };
        expect([...detectTransfers(input, accounts, noFallback)].sort()).toEqual([...detectTransfersReference(input, accounts, noFallback)].sort());
      }
    }
    // the generator must make real pairs, or the comparison proves nothing
    expect(paired).toBeGreaterThan(1000);
  });

  it("pairs thousands of identical weekly moves in well under a second", () => {
    const pairs = 4000;
    const txs: Transaction[] = [];
    for (let i = 0; i < pairs; i++) {
      const day = addDays("2010-01-01", i * 3);
      txs.push(tx({ id: `o${i}`, accountId: "a", bookingDate: day, amountCents: -20000 }), tx({ id: `i${i}`, accountId: "b", bookingDate: day, amountCents: 20000 }));
    }
    const { ms, result: found } = bestOfSync(3, () => detectTransfers(txs, accounts));
    expect(found.size).toBe(pairs * 2);
    expect(ms).toBeLessThan(1000);
  });
});

describe("a credit card is matched to its bills by the bank's name", () => {
  const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
  const bill = tx({ id: "bill", accountId: "chk", bookingDate: "2026-09-20", amountCents: -12000, description: "NORDEA GOLD LASKU", counterparty: "NORDEA RAHOITUS SUOMI OY", category: "card_bill", categorySource: "rule" });

  it("a card the user renamed without its issuer word still matches", () => {
    const card: Account = { id: "card", name: "Matkakortti", bankName: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" };
    expect(detectTransfers([bill], [checking, card]).has("bill")).toBe(true);
    // the same rename without the bank's name known is what broke matching
    expect(detectTransfers([bill], [checking, { ...card, bankName: undefined }]).has("bill")).toBe(false);
  });

  it("the user's name does not make a bill match a card of another issuer", () => {
    const card: Account = { id: "card", name: "Nordea Gold", bankName: "OP Visa", iban: null, currency: "EUR", type: "credit_card" };
    expect(detectTransfers([bill], [checking, card]).has("bill")).toBe(false);
  });
});
