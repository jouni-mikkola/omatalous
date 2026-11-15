/**
 * The invariants the figures break today, over the generated households, each one named down to the household, the
 * view, the month and the exact line (which holds the amounts and counts). invariants.generated.test.ts compares this
 * list with what the checks find, as two sets that must be equal: a new violation fails, a listed one that no longer
 * shows fails, and so does one whose amount or count changed. A fixed finding leaves the list in the change that fixes
 * it. A new false finding is fixed in its own task, never added here.
 */
import type { Check, Violation } from "./invariants.ts";

/** Where a line shows: in one household, in one view of it, in these months (none for a check that does not run by month). */
export interface Where {
  household: string;
  /** "household" or the member id. */
  view: string;
  months: readonly string[];
}

/** One line a check writes, with its amounts and counts, and every place it shows. */
export interface KnownLine {
  line: string;
  where: readonly Where[];
}

export interface KnownViolation {
  /** The name of the finding. */
  finding: string;
  check: Check;
  /** What goes wrong, in one sentence. */
  reason: string;
  lines: readonly KnownLine[];
}

/** The identity of a group of violations that differ only in their month. */
export const identityOf = (check: Check, household: string, view: string, line: string, months: readonly string[]): string => `${check} | ${household} | ${view} | ${line} | months ${months.join(",") || "-"}`;

/** What the checks found, one identity for each household, view and line, with every month it showed in. */
export function foundIdentities(violations: readonly Violation[]): string[] {
  const groups = new Map<string, { v: Violation; months: string[] }>();
  for (const v of violations) {
    const key = `${v.check}|${v.household}|${v.view}|${v.line}`;
    const group = groups.get(key) ?? { v, months: [] };
    if (v.month) group.months.push(v.month);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ v, months }) => identityOf(v.check, v.household, v.view, v.line, months.sort())).sort();
}

/** What the list says, as the same identities. */
export function listedIdentities(list: readonly KnownViolation[]): string[] {
  return list.flatMap((k) => k.lines.flatMap((l) => l.where.map((w) => identityOf(k.check, w.household, w.view, l.line, [...w.months].sort())))).sort();
}

/** The months from `first` to `last`, as `YYYY-MM`. */
function months(first: string, last: string): string[] {
  const out: string[] = [];
  let index = Number(first.slice(0, 4)) * 12 + Number(first.slice(5)) - 1;
  for (;;) {
    const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    out.push(month);
    if (month === last) return out;
    index += 1;
  }
}

// The generated households, by the number of their members (generatedSet in kit/generate.ts).
const WITH_EVENTS = (n: number) => `generated:${n}:said:savings:unconnected:benefit-rule+payment-app+namesake+member-fee+refund:1`;
const FULL_MONTHS = months("2025-04", "2026-05");
/** The month of today, which is only partly over: the joint top-ups (day 3) and the loan's legs (day 4) have happened, the 200 euro top-up of savings has not. */
const LAST_MONTH = ["2026-06"];

/** The same line in the household view and in the view of the given members of one household. */
const views = (household: string, view: readonly string[], by: readonly string[] = []): Where[] => view.map((v) => ({ household, view: v, months: by }));
const sameIn = (households: readonly string[], view: readonly string[], by: readonly string[] = []): Where[] => households.flatMap((h) => views(h, view, by));

const [TWO, THREE, FOUR] = [WITH_EVENTS(2), WITH_EVENTS(3), WITH_EVENTS(4)] as const;

/** The monthly transfer between two members: 8000 cents arrive, 8150 leave, and the money in names no payer account. */
const WITH_FEE = 150;
const ARRIVES = 8000;
/** A bridge line: the residual Tulos leaves, what the moves between daily accounts took, what the accounts outside the pool counted. */
const bridge = (residual: number, moved: number, outside: string) => `residual ${residual}, moved ${moved}, outside the pool ${outside}`;
const saved = (cents: number) => `savings:saved ${cents}`;

/** A member's top-up of a joint account whose holders are unnamed, in the view of each member: 45000 cents in from every other member. */
const TOP_UP = 45_000;
const unnamedJoint = (members: 2 | 3 | 4) => `generated:${members}:unknown:checking:connected:base:1`;
const topUps = (members: 2 | 3 | 4): KnownLine[] => {
  const household = unnamedJoint(members);
  const seen = Array.from({ length: members }, (_, i) => `m${i + 1}`);
  const cents = TOP_UP * (members - 1);
  return [
    { line: bridge(cents, -cents, "none"), where: views(household, seen, LAST_MONTH) },
    { line: bridge(cents, -cents, saved(20_000)), where: views(household, seen, FULL_MONTHS) },
  ];
};

export const KNOWN_VIOLATIONS: readonly KnownViolation[] = [
  {
    finding: "member-transfer-with-fee-has-no-pair",
    check: "I1.bridge",
    reason: "The monthly transfer between two members arrives 150 cents short of what left, and the bank names no payer account on the money in, so no leg pairs by amount or by account. The money in counts as income, in the household view and in the view of the member it arrives to, and the fee is real money out of the pool that no flow takes. A pairing that accepts legs of different amounts, or the change that names the fee as a line of its own, fixes it.",
    lines: [
      { line: bridge(WITH_FEE + ARRIVES, 0, saved(101240)), where: views(TWO, ["household"], FULL_MONTHS) },
      { line: bridge(WITH_FEE + ARRIVES, 0, saved(121240)), where: views(THREE, ["household"], FULL_MONTHS) },
      { line: bridge(WITH_FEE + ARRIVES, 0, saved(141240)), where: views(FOUR, ["household"], FULL_MONTHS) },
      { line: bridge(WITH_FEE + ARRIVES, 0, saved(61240)), where: sameIn([TWO, THREE, FOUR], ["household"], LAST_MONTH) },
      { line: bridge(ARRIVES, 1000, "none"), where: sameIn([TWO, FOUR], ["m2"], LAST_MONTH) },
      { line: bridge(ARRIVES, 3250, "none"), where: views(THREE, ["m2"], LAST_MONTH) },
      { line: bridge(ARRIVES, 1000, saved(20_000)), where: sameIn([TWO, FOUR], ["m2"], FULL_MONTHS) },
      { line: bridge(ARRIVES, 3250, saved(20_000)), where: views(THREE, ["m2"], FULL_MONTHS) },
    ],
  },
  {
    finding: "member-transfer-with-fee-counts-as-income",
    check: "I1b.member-legs",
    reason: "The money in of the same transfer has no pair, so the household view counts it as income.",
    lines: [{ line: "15 legs (member_transfer) count as income", where: sameIn([TWO, THREE, FOUR], ["household"]) }],
  },
  {
    finding: "member-top-up-of-unnamed-joint-account-counts-as-money-from-a-person",
    check: "I1.bridge",
    reason: "A member's top-up of a joint account whose holders the household has not named arrives with no payer account. The view of another member holds none of the top-up's other leg and the name on it is the same one a stranger can have, so the money in counts as money from a person while the rows say it moved between the household's accounts.",
    lines: [...topUps(2), ...topUps(3), ...topUps(4)],
  },
];
