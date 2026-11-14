import { describe, expect, it } from "vitest";
import { pairTransfers } from "../src/pairing.ts";
import type { Account } from "../src/types.ts";
import { tx } from "./helpers.ts";

const accounts: Account[] = [
  { id: "a", name: "Käyttötili", iban: "FI0000000000000001", currency: "EUR", type: "checking" },
  { id: "b", name: "Säästötili", iban: "FI0000000000000002", currency: "EUR", type: "savings" },
];

describe("pairTransfers allocations", () => {
  it("gives each leg of a pair one allocation that holds its whole amount and names the other leg", () => {
    const out = tx({ accountId: "a", bookingDate: "2025-03-03", amountCents: -25000 });
    const inc = tx({ accountId: "b", bookingDate: "2025-03-04", amountCents: 25000 });
    const lone = tx({ accountId: "a", bookingDate: "2025-03-05", amountCents: -999 });
    const { pairs, allocations } = pairTransfers([out, inc, lone], accounts);
    expect([...pairs]).toEqual([[out.id, inc.id]]);
    expect(allocations.get(out.id)).toEqual([{ partnerId: inc.id, cents: 25000, partnerCents: 25000, link: "amount-day", tier: "decided" }]);
    expect(allocations.get(inc.id)).toEqual([{ partnerId: out.id, cents: 25000, partnerCents: 25000, link: "amount-day", tier: "decided" }]);
    expect(allocations.has(lone.id)).toBe(false);
  });

  it("keeps conservation and reciprocity: the parts of a leg add up to its amount and the partner holds the mirror", () => {
    const rows = [];
    for (let i = 0; i < 6; i++) {
      rows.push(tx({ accountId: "a", bookingDate: `2025-04-0${i + 1}`, amountCents: -(1000 + i) }));
      rows.push(tx({ accountId: "b", bookingDate: `2025-04-0${i + 1}`, amountCents: 1000 + i }));
    }
    const { allocations } = pairTransfers(rows, accounts);
    expect(allocations.size).toBe(rows.length);
    for (const row of rows) {
      const parts = allocations.get(row.id)!;
      expect(parts.reduce((s, p) => s + p.cents, 0)).toBe(Math.abs(row.amountCents));
      for (const p of parts) {
        const back = allocations.get(p.partnerId)!.find((q) => q.partnerId === row.id)!;
        expect([back.cents, back.partnerCents]).toEqual([p.partnerCents, p.cents]);
      }
    }
  });
});
