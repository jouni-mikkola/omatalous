/**
 * The invariants of the figures over the generated households (kit/generate.ts), each household in the household view
 * and in each member's view. A violation that kit/known-violations.ts does not list fails, and so does a listed finding
 * that no household shows any more.
 */
import { describe, expect, it } from "vitest";
import { generatedSet, generateHousehold } from "./kit/generate.ts";
import { type Check, type Violation, violationsOf } from "./kit/invariants.ts";
import { KNOWN_VIOLATIONS } from "./kit/known-violations.ts";
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
const describeViolation = (v: Violation) => `${v.check} ${v.household} ${v.view}${v.month ? ` ${v.month}` : ""}: ${v.line}`;

describe("the invariants over the generated households", () => {
  it(
    "fail only where a finding is listed",
    () => {
      const covered = (v: Violation) => KNOWN_VIOLATIONS.some((k) => k.check === v.check && k.covers(v));
      expect(violations().filter((v) => !covered(v)).map(describeViolation)).toEqual([]);
    },
    LONG,
  );

  it(
    "show each listed finding in some household",
    () => {
      expect(KNOWN_VIOLATIONS.filter((k) => !violations().some((v) => v.check === k.check && k.covers(v))).map((k) => k.finding)).toEqual([]);
    },
    LONG,
  );

  it("list each finding once, with its reason", () => {
    expect(new Set(KNOWN_VIOLATIONS.map((k) => k.finding)).size).toBe(KNOWN_VIOLATIONS.length);
    for (const k of KNOWN_VIOLATIONS) expect(k.reason.length, k.finding).toBeGreaterThan(40);
  });

  it(
    "hold the checks that already pass: the wallet role and the loan parts",
    () => {
      const held: Check[] = ["I3c.wallet-role", "I4.loan-parts"];
      expect(violations().filter((v) => held.includes(v.check)).map(describeViolation)).toEqual([]);
      expect(KNOWN_VIOLATIONS.filter((k) => held.includes(k.check))).toEqual([]);
    },
    LONG,
  );

  it(
    "show the loan paid from savings in every count of members",
    () => {
      const twice = violations().filter((v) => v.check === "I1.bridge" && v.line.includes("savings:debt"));
      for (const n of [1, 2, 3, 4]) expect(twice.some((v) => v.household.startsWith(`generated:${n}:`) && v.view === "household"), `${n} members`).toBe(true);
    },
    LONG,
  );
});
