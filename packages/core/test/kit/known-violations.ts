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
const CHECKING_LOAN = "generated:2:said:checking:connected:base:1";
const FULL_MONTHS = months("2025-04", "2026-05");
/** The month of today, which is only partly over: the joint top-ups (day 3) and the loan's legs (day 4) have happened, the 200 euro top-up of savings has not. */
const LAST_MONTH = ["2026-06"];
const JOINT_UNKNOWN = (n: number) => `generated:${n}:unknown:checking:connected:base:1`;

/** The same line in the household view and in the view of the given members of one household. */
const views = (household: string, view: readonly string[], by: readonly string[] = []): Where[] => view.map((v) => ({ household, view: v, months: by }));
const sameIn = (households: readonly string[], view: readonly string[], by: readonly string[] = []): Where[] => households.flatMap((h) => views(h, view, by));

const [ONE, TWO, THREE, FOUR] = [WITH_EVENTS(1), WITH_EVENTS(2), WITH_EVENTS(3), WITH_EVENTS(4)] as const;
const EVENT_HOUSEHOLDS = [ONE, TWO, THREE, FOUR];

/** The residual of the monthly transfer between two members (8000 cents, fee 150): the fee in the household view, the 8150 cents sent in the first member's view. */
const [WITH_FEE, WITH_SENT] = [150, -8150] as const;
/** A bridge line: the residual Tulos leaves, what the moves between daily accounts took, what savings accounts counted. */
const bridge = (residual: number, moved: number, saved: number) => `residual ${residual}, moved ${moved}, outside the pool savings:saved ${saved}`;
/** A bridge line of a month with no savings top-up of the household's own (the month of today) or with the 200 euro one. */
const topUps = (residual: number, moved: number, month: "full" | "last") => `residual ${residual}, moved ${moved}, outside the pool ${month === "full" ? "savings:saved 20000" : "none"}`;
/** The joint account's top-ups from the other members' accounts that a member's view counts as income, in each month. */
const joint = (n: number, view: string, residual: number, moved: number): KnownLine[] => [
  { line: topUps(residual, moved, "full"), where: views(JOINT_UNKNOWN(n), [view], FULL_MONTHS) },
  { line: topUps(residual, moved, "last"), where: views(JOINT_UNKNOWN(n), [view], LAST_MONTH) },
];
const WALLET_IN = (rows: number) => `${rows} rows: person income counted as income 0, consumption -1800, debt 0`;

export const KNOWN_VIOLATIONS: readonly KnownViolation[] = [
  {
    finding: "member-transfer-fee-left-in-residual",
    check: "I1.bridge",
    reason: "The monthly transfer between two members has a fee of 150 cents. The fee is real money out of the pool, which Tulos does not count: no flow takes it, so it stays in the residual of the household view. The change that names the fee as a line of its own fixes it.",
    lines: [
      { line: bridge(WITH_FEE, 0, 101240), where: views(TWO, ["household"], FULL_MONTHS) },
      { line: bridge(WITH_FEE, 0, 121240), where: views(THREE, ["household"], FULL_MONTHS) },
      { line: bridge(WITH_FEE, 0, 141240), where: views(FOUR, ["household"], FULL_MONTHS) },
      { line: bridge(WITH_FEE, 0, 61240), where: sameIn([TWO, THREE, FOUR], ["household"], LAST_MONTH) },
    ],
  },
  {
    finding: "member-transfer-sent-counted-as-payment",
    check: "I1.bridge",
    reason: "In the first member's view the monthly transfer to the other member, 8000 cents and its fee, goes out of the pool and Tulos counts it as a payment to a person, though the money only moved between the household's own accounts. The change that makes a transfer between household accounts neutral in every view fixes it.",
    lines: [
      { line: bridge(WITH_SENT, -850, 81240), where: [...views(TWO, ["m1"], FULL_MONTHS), ...views(FOUR, ["m1"], FULL_MONTHS)] },
      { line: bridge(WITH_SENT, 2525, 81240), where: views(THREE, ["m1"], FULL_MONTHS) },
      { line: bridge(WITH_SENT, -850, 61240), where: [...views(TWO, ["m1"], LAST_MONTH), ...views(FOUR, ["m1"], LAST_MONTH)] },
      { line: bridge(WITH_SENT, 2525, 61240), where: views(THREE, ["m1"], LAST_MONTH) },
    ],
  },
  {
    finding: "member-transfer-counted-as-person-income",
    check: "I1.bridge",
    reason: "The monthly transfer between two members arrives in the second member's view from an account the view does not hold, and Tulos counts the 8000 cents as money earned, though it only moved between the household's own accounts.",
    lines: [
      { line: topUps(8000, 1000, "full"), where: [...views(TWO, ["m2"], FULL_MONTHS), ...views(FOUR, ["m2"], FULL_MONTHS)] },
      { line: topUps(8000, 1000, "last"), where: [...views(TWO, ["m2"], LAST_MONTH), ...views(FOUR, ["m2"], LAST_MONTH)] },
      { line: topUps(8000, 3250, "full"), where: views(THREE, ["m2"], FULL_MONTHS) },
      { line: topUps(8000, 3250, "last"), where: views(THREE, ["m2"], LAST_MONTH) },
    ],
  },
  {
    finding: "joint-top-up-of-another-member-counted-as-income",
    check: "I1.bridge",
    reason: "A joint account with an unknown split is read with the first member's accounts only, and every member's part of it is whole, so applyUse returns early (account-use.ts) before its rule that money into a shared account from a household account is a transfer. The other members' top-ups keep the first member's reading and arrive in a member's view from an account the view does not hold, though they only moved between the household's own accounts.",
    lines: [
      ...joint(2, "m1", 45000, -45000),
      ...joint(3, "m1", 90000, -90000),
      ...joint(3, "m2", 45000, -90000),
      ...joint(3, "m3", 45000, -90000),
      ...joint(4, "m1", 135000, -135000),
      ...joint(4, "m2", 90000, -135000),
      ...joint(4, "m3", 90000, -135000),
      ...joint(4, "m4", 90000, -135000),
    ],
  },
  {
    finding: "wallet-payment-in-counted-as-spending-taken-back",
    check: "I3.labelled-flow",
    reason: "A payment in through the wallet that names no sender is income from a person, and the figures count it as 1800 cents of spending taken back.",
    lines: [
      { line: WALLET_IN(4), where: sameIn([ONE, TWO, FOUR], ["household", "m1"]) },
      { line: WALLET_IN(6), where: views(THREE, ["household", "m1"]) },
    ],
  },
  {
    finding: "wallet-payment-in-under-spending",
    check: "I3a.money-in",
    reason: "A payment in through the wallet that names no sender sits in a spending category (groceries), where it counts as spending taken back.",
    lines: [
      { line: "4 rows in, no sender as groceries", where: sameIn([ONE, TWO, FOUR], ["household", "m1"]) },
      { line: "6 rows in, no sender as groceries", where: views(THREE, ["household", "m1"]) },
    ],
  },
  {
    finding: "rule-on-money-in",
    check: "I3a.money-in",
    reason: "A rule for medical payees puts the benefits that the social insurance institution pays in under health, a category of money out.",
    lines: [{ line: "15 rows in, KELA as health", where: sameIn(EVENT_HOUSEHOLDS, ["household", "m1"]) }],
  },
  {
    finding: "payment-app-prefix-turns-business-into-person",
    check: "I3b.prefix",
    reason: "The payment-app prefix in front of a business name makes the payee a person's, so a pizzeria paid through the app counts as a payment to a person.",
    lines: [
      { line: "15 rows: MOBILEPAY TAIKA PIZZA is a business and counts as p2p", where: sameIn(EVENT_HOUSEHOLDS, ["household", "m1"]) },
      { line: "with the prefix MOBILEPAY TAIKA PIZZA is a person, without it TAIKA PIZZA is a payee", where: sameIn(EVENT_HOUSEHOLDS, ["household", "m1"]) },
    ],
  },
  {
    finding: "unproven-balances-go-unsaid",
    check: "I5.unproven",
    reason: "Seven accounts have no reference day, so nothing proves their balances, and the data quality report says nothing about it.",
    lines: [{ line: "7 accounts have no proof (no_reference_day) and the report says nothing", where: views(CHECKING_LOAN, ["household"]) }],
  },
];
