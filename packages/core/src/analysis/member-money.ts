/**
 * Money in from another member of the household that no pairing explained: in a member's own view the other leg of a
 * movement between two members is on the other member's account, so the row stays a person's money in. It is neither
 * income nor a transfer until the household says what it is, so it is asked as a payer (Tarkistettavat), and the answer
 * is the payer's role like any other.
 *
 * Decision: the household settles what a member's money is (a share of the costs, a gift, a sale) once per payer, and
 * the rest of the unexplained money between members stays in view as a question and in no other figure.
 */
import { payerKeyOf } from "../payer-role.ts";
import { memberNamed, type Name, nameOf } from "../person-names.ts";
import { normalizeIban } from "../transfers.ts";
import type { IsoDate } from "../types.ts";
import type { AnalysisTx } from "./context.ts";

/** A member of the household as the accounts tell it: the name their own accounts give, and the numbers of those accounts. */
export interface HouseholdMember {
  id: string;
  name: Name | null;
  ibans: ReadonlySet<string>;
}

/**
 * The one member a row's counterparty is. A row with an account number is decided by that number alone (a stranger who
 * has a member's name is a stranger); a row with a name only, by the name, and only when one member has it: two
 * members of one name cannot be told apart, so the row has no member, and nor can a member with no name of their own
 * be ruled out (`memberNamed`).
 */
export function memberOfRow(members: readonly HouseholdMember[], t: Pick<AnalysisTx, "counterparty" | "counterpartyIban">, viewerId: string): HouseholdMember | null {
  const iban = normalizeIban(t.counterpartyIban);
  if (iban) {
    const hits = members.filter((m) => m.ibans.has(iban));
    return hits.length === 1 ? hits[0]! : null;
  }
  return t.counterparty?.trim() ? memberNamed(members, nameOf(t.counterparty), viewerId) : null;
}

/** One payer whose money in from a member nothing explained. */
interface MemberMoney {
  /** The payer, as `payerKeyOf` writes it: the key of the answer. */
  key: string;
  /** The payer's name as its largest row writes it. */
  merchant: string;
  /** What the rows add up to, positive. */
  cents: number;
  count: number;
  rowIds: string[];
  lastDate: IsoDate;
}

/** Rows a decision has settled: set by hand, matched to a purchase, paired as a transfer, or moved by a payer's role. */
const SETTLED = new Set(["user", "match", "transfer", "payer"]);

/**
 * The unexplained money in from other members, by payer, from `from` on, the largest first. `answered`: the rows whose
 * payer has a role, which is the role's to say. The viewer's own accounts and rows that name the viewer are no one else's.
 */
export function memberMoney(rows: readonly AnalysisTx[], members: readonly HouseholdMember[], viewerId: string, from: IsoDate, answered: (t: AnalysisTx) => boolean): MemberMoney[] {
  const groups = new Map<string, { largest: AnalysisTx; cents: number; ids: string[]; last: IsoDate }>();
  for (const t of rows) {
    if (t.amountCents <= 0 || t.flows.income <= 0 || t.status !== "booked" || t.isTransfer || t.bookingDate < from || SETTLED.has(t.categorySource) || answered(t)) continue;
    const member = memberOfRow(members, t, viewerId);
    const key = member && member.id !== viewerId ? payerKeyOf(t) : null;
    if (!key) continue;
    const g = groups.get(key);
    if (!g) groups.set(key, { largest: t, cents: t.amountCents, ids: [t.id], last: t.bookingDate });
    else {
      g.cents += t.amountCents;
      g.ids.push(t.id);
      if (t.amountCents > g.largest.amountCents) g.largest = t;
      if (t.bookingDate > g.last) g.last = t.bookingDate;
    }
  }
  return [...groups].map(([key, g]) => ({ key, merchant: g.largest.merchant, cents: g.cents, count: g.ids.length, rowIds: g.ids, lastDate: g.last })).sort((a, b) => b.cents - a.cents || (a.key < b.key ? -1 : 1));
}
