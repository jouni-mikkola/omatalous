import { describe, expect, it } from "vitest";
import { partCents } from "../src/account-use.ts";
import { poolOf } from "../src/analysis/pool.ts";
import type { BalanceInput, Part } from "../src/types.ts";

const account = (id: string, type: BalanceInput["type"], balanceCents: number | null, extra: Partial<BalanceInput> = {}): BalanceInput => ({ id, name: id, type, balanceCents, ownerName: null, balanceAt: "2026-06-15", ...extra });

/** Three members share one joint account in the weights 1, 2 and 3: the parts of the one range 0..6 that add up to the whole. */
const PARTS: readonly Part[] = [
  { from: 0, to: 1, of: 6 },
  { from: 1, to: 3, of: 6 },
  { from: 3, to: 6, of: 6 },
];
const JOINT_CENTS = 100_003;

/** A member's own view of the balances, each at the member's part once, as the server gives them. */
const viewOf = (i: number): BalanceInput[] => [
  account(`chk-${i}`, "checking", 250_000 + i),
  account("joint", "checking", partCents(JOINT_CENTS, PARTS[i]!), { part: PARTS[i]! }),
  account(`sav-${i}`, "savings", 900_000),
  account(`card-${i}`, "credit_card", -12_345),
];

/** What the pool of these balances holds; every balance of the fixtures that use it is known. */
const held = (balances: readonly BalanceInput[]): number => {
  const { cents } = poolOf(balances);
  if (cents === null) throw new Error("the pool has no sum");
  return cents;
};

describe("poolOf", () => {
  it("adds a balance that is already cut to the viewer's part, and never cuts it again", () => {
    expect(poolOf(viewOf(0)).cents).toBe(250_000 + 16_667);
    expect(poolOf(viewOf(1)).cents).toBe(250_001 + 33_335);
    expect(poolOf(viewOf(2)).cents).toBe(250_002 + 50_001);
  });

  it("gives members pools that add up to the household's pool to the cent", () => {
    const members = [0, 1, 2].map((i) => held(viewOf(i)));
    const household = held([account("chk-0", "checking", 250_000), account("chk-1", "checking", 250_001), account("chk-2", "checking", 250_002), account("joint", "checking", JOINT_CENTS)]);
    expect(members.reduce((s, c) => s + c, 0)).toBe(household);
  });

  it("holds the same for a negative balance and for a cent that does not split evenly", () => {
    const owed = -100_001;
    const shares = PARTS.map((part) => held([account("joint", "checking", partCents(owed, part), { part })]));
    expect(shares.reduce((s, c) => s + c, 0)).toBe(owed);
    expect(shares.every((c) => c <= 0)).toBe(true);
  });

  it("holds the checking accounts of the view and nothing else", () => {
    const pool = poolOf(viewOf(1));
    expect([...pool.ids].sort()).toEqual(["chk-1", "joint"]);
  });

  it("names the pool a part when an account is counted at less than its whole, and all otherwise", () => {
    expect(poolOf(viewOf(0)).kind).toBe("part");
    expect(poolOf([account("chk-0", "checking", 1, { part: { from: 0, to: 1, of: 1 } })]).kind).toBe("all");
    expect(poolOf([account("chk-0", "checking", 1)]).kind).toBe("all");
  });

  it("leaves out an account the viewer has none of", () => {
    const pool = poolOf([account("joint", "checking", 5_000, { part: { from: 0, to: 0, of: 6 } }), account("chk-0", "checking", 300), account("chk-1", "checking", 700)]);
    expect([...pool.ids]).toEqual(["chk-0", "chk-1"]);
    expect(pool.cents).toBe(1_000);
  });

  it("holds no sum while an account of the pool has no known balance", () => {
    const pool = poolOf([account("chk-0", "checking", null), account("chk-1", "checking", 700)]);
    expect([...pool.ids]).toEqual(["chk-0", "chk-1"]);
    expect(pool.cents).toBeNull();
    // a balance nobody knows of an account outside the pool does not blank it
    expect(poolOf([account("chk-1", "checking", 700), account("sav-0", "savings", null)]).cents).toBe(700);
  });
});
