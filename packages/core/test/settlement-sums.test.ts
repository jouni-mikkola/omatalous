/** The sums the settlement block shows (`settlementSums`): made-up members and sums. */
import { describe, expect, it } from "vitest";
import { settlementSums } from "../src/settlement.ts";

const quiet = { members: [], unknownHolder: [] };

describe("the sums of a pool's month", () => {
  it("adds up the transfers, the credits and the debts of the members", () => {
    const sums = settlementSums({ ...quiet, members: [{ owner: "u:a", paid: 0, owed: 0, over: 3000 }, { owner: "u:b", paid: 0, owed: 0, over: -2000 }, { owner: "u:c", paid: 0, owed: 0, over: -1000 }] });
    expect(sums.transfers).toEqual([{ from: "u:b", to: "u:a", cents: 2000 }, { from: "u:c", to: "u:a", cents: 1000 }]);
    expect(sums.owedCents).toBe(3000);
    expect(sums.creditCents).toBe(3000);
    expect(sums.debtCents).toBe(3000);
    expect(sums.openCents).toBe(0);
  });

  it("leaves the part nobody's figure pairs with as the open sum", () => {
    const sums = settlementSums({ ...quiet, members: [{ owner: "u:a", paid: 0, owed: 0, over: 5000 }, { owner: "u:b", paid: 0, owed: 0, over: -3000 }] });
    expect(sums.owedCents).toBe(3000);
    expect(sums.openCents).toBe(2000);
  });

  it("adds up the costs of an untold split and the bills of a card with no known holder, 0 when there are none", () => {
    const told = settlementSums(quiet);
    expect(told.untoldCents).toBe(0);
    expect(told.heldBackCents).toBe(0);
    const sums = settlementSums({ ...quiet, untold: [{ key: "k1", day: 1, cents: 4000 }, { key: "k2", day: 2, cents: 1250 }], unknownHolder: [{ key: "k3", day: 3, cents: 700 }, { key: "k4", day: 4, cents: 800 }] });
    expect(sums.untoldCents).toBe(5250);
    expect(sums.heldBackCents).toBe(1500);
  });
});
