/**
 * The ground truth of a generated household (generate.ts): what each row really is, written down when the row is made
 * and never read back from the engine. An invariant test compares the engine's verdicts with these labels, so a new
 * bank wording changes the rows and leaves the labels alone.
 */
import type { ReconcileBalance } from "../../src/reconcile.ts";
import type { Account, Transaction } from "../../src/types.ts";
import type { Household, HouseholdMember, SharedAccount } from "../../../../tools/findings/households.ts";

/**
 * Where a row lands in the household's books. A transfer is money between the household's own accounts (both legs);
 * `mirror` is the loan account's own row, which repeats a payment already counted on the account that paid it.
 */
export type Flow = "income" | "consumption" | "debt" | "borrowed" | "transfer" | "mirror";

/** What the money is: the label the engine's category and the questions of the review are judged by. */
export type Kind =
  | "salary"
  | "benefit"
  | "rent"
  | "shop"
  | "refund"
  | "person"
  | "business"
  | "own_transfer"
  | "member_transfer"
  | "card_bill"
  | "loan_instalment"
  | "loan_mirror";

/** The optional happenings of a generated household. Each one is a past finding or a shape that produced one. */
export type EventId =
  /** Money in from a payee the household also has a spending rule for. */
  | "benefit-rule"
  /** A payment-app prefix on a business and on a person. */
  | "payment-app"
  /** A stranger who has the name of a member. */
  | "namesake"
  /** A transfer between two members that arrives short of what left (a fee), so no leg pairs by amount. */
  | "member-fee"
  /** A purchase paid back in full later in the month. */
  | "refund";

export interface Truth {
  kind: Kind;
  flow: Flow;
  /** The member whose own money it is; null for money of the joint account or of the household at large. */
  member: string | null;
  /** The event that made the row, or null for the monthly base. */
  event: EventId | "loan-from-savings" | null;
  /** The id of the other leg of a transfer, a card bill or a loan instalment. */
  pair?: string;
  /** Cents the bank took out of this leg on top of the amount that arrived on the other. */
  feeCents?: number;
}

/** How a household is made. Everything the generator draws comes from `seed`, and a fixed spec gives the same rows. */
export interface Spec {
  /** Members who each link their own accounts: 1 to 4. */
  members: 1 | 2 | 3 | 4;
  /** Months of history before today's month. Default 14. */
  months?: number;
  /** A joint checking account held by all members (and, for one member, by a person who is no member). */
  joint?: "none" | "said" | "unknown";
  /** Where the loan instalment is paid from; `savings` first moves the money from checking to the first member's savings. */
  loan?: "none" | "checking" | "savings" | "joint";
  /** `connected`: each member has a card account and its bills are transfers. `unconnected`: the bill is a payment to the issuer. */
  cards?: "none" | "connected" | "unconnected";
  events?: readonly EventId[];
  /** Whether the balances the bank gives carry a reference day. Default true; without one no balance proves. */
  reference?: boolean;
}

export interface GeneratedHousehold extends Household {
  spec: Spec;
  members: readonly HouseholdMember[];
  shared: readonly SharedAccount[];
  truth: ReadonlyMap<string, Truth>;
  /** The stored bank balances of each account that reconciles, as `reconcile` reads them. */
  anchors: ReadonlyMap<string, readonly ReconcileBalance[]>;
  /** What each account held before its first row, by account id. */
  openings: ReadonlyMap<string, number>;
}

/** The sum of the rows' cents by the flow their label gives. Loan accounts' rows are in `mirror`. */
export function centsByFlow(txs: readonly Transaction[], truth: ReadonlyMap<string, Truth>): Record<Flow, number> {
  const sums: Record<Flow, number> = { income: 0, consumption: 0, debt: 0, borrowed: 0, transfer: 0, mirror: 0 };
  for (const t of txs) sums[truth.get(t.id)!.flow] += t.amountCents;
  return sums;
}

/** What is wrong with the labels of `h`: rows with none, labels with no row, legs that do not pair, flows that do not add up. */
export function labelProblems(h: Pick<GeneratedHousehold, "txs" | "truth" | "accounts">): string[] {
  const problems: string[] = [];
  const byId = new Map(h.txs.map((t) => [t.id, t]));
  for (const t of h.txs) if (!h.truth.has(t.id)) problems.push(`row ${t.id} has no label`);
  for (const id of h.truth.keys()) if (!byId.has(id)) problems.push(`label ${id} has no row`);
  const loans = new Set(h.accounts.filter((a: Account) => a.type === "loan").map((a) => a.id));
  for (const t of h.txs) {
    const l = h.truth.get(t.id);
    if (!l) continue;
    if ((l.flow === "mirror") !== loans.has(t.accountId)) problems.push(`row ${t.id}: a loan account's rows, and only those, are mirrors`);
    if ((l.flow === "income" || l.flow === "borrowed") && t.amountCents <= 0) problems.push(`row ${t.id}: ${l.flow} is money in`);
    if ((l.flow === "debt") && t.amountCents >= 0) problems.push(`row ${t.id}: debt paid is money out`);
    if (l.pair === undefined) {
      if (l.flow === "transfer") problems.push(`row ${t.id}: a transfer has two legs`);
      continue;
    }
    const other = byId.get(l.pair);
    const back = h.truth.get(l.pair);
    if (!other || back?.pair !== t.id) problems.push(`row ${t.id}: its pair ${l.pair} does not point back`);
    else if (t.id < other.id && t.amountCents + other.amountCents !== -((l.feeCents ?? 0) + (back.feeCents ?? 0))) problems.push(`row ${t.id}: legs do not net to the fee`);
  }
  const sums = centsByFlow(h.txs, h.truth);
  const fees = [...h.truth.values()].reduce((s, l) => s + (l.feeCents ?? 0), 0);
  // the legs of the transfers net to what the banks kept, so every cent of a non-loan account is in one flow
  if (sums.transfer !== -fees) problems.push(`transfers net to ${sums.transfer}, the fees are ${fees}`);
  return problems;
}
