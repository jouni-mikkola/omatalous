import { describe, expect, it } from "vitest";
import { hasNothing, holderNameOf, transfersOf, untoldTotal } from "../src/pages/reports/sections/settlement-text.ts";

const quiet = { members: [{ paid: 0, owed: 0 }, { paid: 0, owed: 0 }], unknownPaidBy: [], unknownOwedBy: [], unknownHolder: [], lines: [] };

describe("the pools of a month in Yhteiset menot", () => {
  it("a pool with nothing paid and no part for anyone has no row to list", () => {
    expect(hasNothing(quiet)).toBe(true);
    expect(hasNothing({ ...quiet, unknownPaidBy: [{ cents: 0 }] })).toBe(true);
  });
  it("a pool where anyone paid, owes a part, or has an unknown figure or a late correction is listed", () => {
    expect(hasNothing({ ...quiet, members: [{ paid: 1250, owed: 0 }, { paid: 0, owed: 0 }] })).toBe(false);
    expect(hasNothing({ ...quiet, members: [{ paid: 0, owed: 0 }, { paid: 0, owed: 600 }] })).toBe(false);
    expect(hasNothing({ ...quiet, unknownOwedBy: [{ cents: 300 }] })).toBe(false);
    expect(hasNothing({ ...quiet, unknownHolder: [{ cents: 300 }] })).toBe(false);
    expect(hasNothing({ ...quiet, lines: [{ kind: "late_change" }] })).toBe(false);
  });
});

describe("a pool whose split nobody has told", () => {
  it("is listed for its costs, and the costs add up", () => {
    const untold = [{ cents: 4000 }, { cents: 1250 }];
    expect(hasNothing({ ...quiet, untold })).toBe(false);
    expect(hasNothing({ ...quiet, untold: [] })).toBe(true);
    expect(untoldTotal({ untold })).toBe(5250);
    expect(untoldTotal({})).toBe(0);
  });
});

describe("the co-holder with no login", () => {
  const use = (label: string) => ({ users: [{ userId: "a", label: "Matti Meikalainen", weight: 1 }, { userId: null, label, weight: 1 }] });
  it("is named as the account's use names them", () => {
    expect(holderNameOf(use("Maija Meikalainen"))).toBe("Maija Meikalainen");
  });
  it("has no name where the use says only that there is another holder, or has no such user", () => {
    expect(holderNameOf(use("Muu tilinomistaja"))).toBeNull();
    expect(holderNameOf({ users: [{ userId: "a", label: "Matti Meikalainen", weight: 1 }] })).toBeNull();
    expect(holderNameOf(undefined)).toBeNull();
  });
});

describe("who owes whom", () => {
  it("two partners: the one under the share pays the other, and the sum is what the over figure says", () => {
    expect(transfersOf([{ owner: "u:a", over: 4050 }, { owner: "u:b", over: -4050 }])).toEqual([{ from: "u:b", to: "u:a", cents: 4050 }]);
  });
  it("three partners: the transfers add up to the sum of the debts and the sum of the credits", () => {
    const members = [{ owner: "u:a", over: 7000 }, { owner: "u:b", over: -2500 }, { owner: "u:c", over: -4500 }];
    const t = transfersOf(members);
    expect(t).toEqual([{ from: "u:c", to: "u:a", cents: 4500 }, { from: "u:b", to: "u:a", cents: 2500 }]);
    expect(t.reduce((s, x) => s + x.cents, 0)).toBe(7000);
  });
  it("a debt split over two creditors, and an even month with nothing to pay", () => {
    const t = transfersOf([{ owner: "u:a", over: 3000 }, { owner: "u:b", over: 2000 }, { owner: "u:c", over: -5000 }]);
    expect(t).toEqual([{ from: "u:c", to: "u:a", cents: 3000 }, { from: "u:c", to: "u:b", cents: 2000 }]);
    // unknown money leaves a credit with no debtor: only the matched part is a transfer
    expect(transfersOf([{ owner: "u:a", over: 5000 }, { owner: "u:b", over: -3000 }])).toEqual([{ from: "u:b", to: "u:a", cents: 3000 }]);
    expect(transfersOf([{ owner: "u:a", over: 2000 }, { owner: "u:b", over: 0 }])).toEqual([]);
    expect(transfersOf([{ owner: "u:a", over: 0 }, { owner: "u:b", over: 0 }])).toEqual([]);
  });
});
