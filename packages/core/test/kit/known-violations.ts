/**
 * The invariants the figures break today, over the generated households. The list may only shrink: a violation that no
 * entry covers fails invariants.generated.test.ts, and so does an entry that no violation matches any more, so a fixed
 * finding leaves the list in the change that fixes it and cannot come back unseen. A new false finding is fixed in its
 * own task, never added here.
 */
import type { Check, Violation } from "./invariants.ts";

export interface KnownViolation {
  /** The name of the finding. */
  finding: string;
  check: Check;
  /** The violations of `check` that this entry stands for. */
  covers: (v: Violation) => boolean;
  /** What goes wrong, down to the line of code where the engine goes wrong. */
  reason: string;
}

export const KNOWN_VIOLATIONS: readonly KnownViolation[] = [
  {
    finding: "rule-on-money-in",
    check: "I3a.money-in",
    covers: (v) => v.line.includes("KELA as health"),
    reason: "a merchant rule of the household reads money that comes in: compileRules has no direction (categorize.ts:488-497, the loop at :518) and the benefit payer, which has a spending rule, lands in health",
  },
  {
    finding: "loan-from-savings-counted-twice",
    check: "I1.bridge",
    covers: (v) => v.line.includes("savings:debt"),
    reason: "the top-up from checking to savings is saved on the pool's own row and the instalment paid from savings is debt on the savings row (flowsOf, flows.ts:30-37), so Tulos leaves twice by one loan payment",
  },
  {
    finding: "member-legs-as-person-payments",
    check: "I1b.member-legs",
    covers: () => true,
    reason: "a transfer between members that arrives short of what left (a fee) pairs on no exact amount (pairing.ts:299) and has no account number on its rows, so both legs read as person payments in the household view",
  },
  {
    finding: "payment-app-prefix-turns-business-into-person",
    check: "I3b.prefix",
    covers: (v) => v.line.includes("TAIKA PIZZA"),
    reason: "viaMobilePay (categorize-people.ts:87-92) calls a payee with the prefix a person when its name has the shape of one and no company form, where the same name alone is a restaurant",
  },
  {
    finding: "pool-counts-one-account",
    check: "I1.pool-accounts",
    covers: () => true,
    reason: "Käytettävissä counts the member's own accounts and leaves a joint account out when the member has one of their own (countedAccounts, ahead-moves.ts:53-58), where Tulos counts the joint account at the member's part",
  },
  {
    finding: "ahead-starts-from-another-pool",
    check: "I1.pool-balance",
    covers: () => true,
    reason: "Käytettävissä starts from the sum of the counted accounts alone (ahead.ts:417), a smaller sum than the pool holds, and takes off the debt of every card in view (ahead.ts:410)",
  },
  {
    finding: "unproven-balance-is-silent",
    check: "I5.unproven",
    covers: () => true,
    reason: "reconcile answers unknown without a reference day (reconcile.ts, no_reference_day) and neither the data-quality list nor the review queue says so (review.ts asks only for differs)",
  },
];
