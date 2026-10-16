import { describe, expect, it } from "vitest";
import { hasNothing, holderNameOf } from "../src/pages/reports/sections/settlement-text.ts";

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
