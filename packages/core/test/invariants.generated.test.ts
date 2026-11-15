/**
 * The invariants of the figures over the generated households (kit/generate.ts), each household in the household view
 * and in each member's view. What the checks find must equal kit/known-violations.ts exactly: household, view, month,
 * line and the amounts and counts in it. A new violation fails, a listed one that no longer shows fails, and so does
 * one whose amount changed.
 */
import { describe, expect, it } from "vitest";
import { generatedSet, generateHousehold } from "./kit/generate.ts";
import { type Check, type Violation, violationsOf } from "./kit/invariants.ts";
import { foundIdentities, KNOWN_VIOLATIONS, listedIdentities } from "./kit/known-violations.ts";
import type { GeneratedHousehold, Spec } from "./kit/truth.ts";

const LONG = 60_000;

/** The set and one household with no reference day, which only the proof check reads. */
const UNPROVEN: Spec = { members: 2, joint: "said", loan: "checking", cards: "connected", reference: false };
let all: Violation[] | null = null;
const violations = (): Violation[] => {
  if (all) return all;
  const twin = generateHousehold({ ...UNPROVEN, reference: true }, 1);
  const households: GeneratedHousehold[] = [...generatedSet(), generateHousehold(UNPROVEN, 1)];
  return (all = households.flatMap((h) => violationsOf(h, h.spec.reference === false ? twin : undefined)));
};

describe("the invariants over the generated households", () => {
  it(
    "fail exactly where the list says, in each household, view and month, with each amount",
    () => {
      expect(foundIdentities(violations())).toEqual(listedIdentities(KNOWN_VIOLATIONS));
    },
    LONG,
  );

  it("list each finding once, with its reason and at least one place", () => {
    expect(new Set(KNOWN_VIOLATIONS.map((k) => k.finding)).size).toBe(KNOWN_VIOLATIONS.length);
    for (const k of KNOWN_VIOLATIONS) {
      expect(k.reason.length, k.finding).toBeGreaterThan(40);
      expect(k.lines.length, k.finding).toBeGreaterThan(0);
      for (const l of k.lines) expect(l.where.length, `${k.finding}: ${l.line}`).toBeGreaterThan(0);
    }
  });

  it("compare as sets: a new violation, a missing one and a changed amount each make the two differ", () => {
    const known = [{ finding: "f", check: "I1.bridge" as Check, reason: "r", lines: [{ line: "residual -100", where: [{ household: "h", view: "household", months: ["2026-01", "2026-02"] }] }] }];
    const v = (line: string, month: string): Violation => ({ check: "I1.bridge", household: "h", view: "household", month, line });
    const same = [v("residual -100", "2026-02"), v("residual -100", "2026-01")];
    expect(foundIdentities(same)).toEqual(listedIdentities(known));
    expect(foundIdentities([...same, v("residual -5", "2026-03")])).not.toEqual(listedIdentities(known));
    expect(foundIdentities(same.slice(0, 1))).not.toEqual(listedIdentities(known));
    expect(foundIdentities([])).not.toEqual(listedIdentities(known));
    expect(foundIdentities(same.map((x) => ({ ...x, line: "residual -101" })))).not.toEqual(listedIdentities(known));
  });

  it(
    "hold the checks that already pass: the wallet role and the loan parts",
    () => {
      const held: Check[] = ["I3c.wallet-role", "I4.loan-parts"];
      expect(violations().filter((v) => held.includes(v.check))).toEqual([]);
      expect(KNOWN_VIOLATIONS.filter((k) => held.includes(k.check))).toEqual([]);
    },
    LONG,
  );
});
