// What the settlement block of Raportit says of a pool: who a payer with no login is, and which pools have nothing to show
import { type AccountUse, OTHER_HOLDER } from "@banking/core";

/** The co-holder with no login, named as the account's use names them (Asetukset and the sources of Tilit): null when no name is known. */
export function holderNameOf(use: Pick<AccountUse, "users"> | null | undefined): string | null {
  const label = use?.users.find((u) => u.userId === null)?.label.trim();
  return label && label !== OTHER_HOLDER ? label : null;
}

interface MonthPool {
  members: readonly { paid: number; owed: number }[];
  unknownPaidBy: readonly { cents: number }[];
  unknownOwedBy: readonly { cents: number }[];
  unknownHolder: readonly { cents: number }[];
  lines: readonly { kind: string }[];
  untold?: readonly { cents: number }[];
}

/** A pool whose month has paid 0,00 and a part of 0,00 for everyone, and no unknown payer or late correction: it has no row to list. */
export const hasNothing = (s: MonthPool): boolean =>
  s.members.every((m) => m.paid === 0 && m.owed === 0) &&
  [...s.unknownPaidBy, ...s.unknownOwedBy, ...s.unknownHolder, ...(s.untold ?? [])].every((e) => e.cents === 0) &&
  s.lines.every((l) => l.kind !== "late_change");

/** What the month's costs came to where nobody has told the pool's split (core leaves them out of paid and owed): 0 when the split is known. */
export const untoldTotal = (s: Pick<MonthPool, "untold">): number => (s.untold ?? []).reduce((sum, e) => sum + e.cents, 0);

export interface Transfer {
  from: string;
  to: string;
  cents: number;
}

/**
 * Who pays whom to settle the month: the ones who paid under their share pay the ones who paid over, the largest
 * debtor to the largest creditor first. The transfers add up to the smaller of the sum of the credits and the sum of the debts; the two
 * differ by what is unknown (core: `sum(over) = unknownOwed - unknownPaid`), and the page names that difference.
 */
export function transfersOf(members: readonly { owner: string; over: number }[]): Transfer[] {
  const debtors = members.filter((m) => m.over < 0).map((m) => ({ owner: m.owner, left: -m.over })).sort((a, b) => b.left - a.left || (a.owner < b.owner ? -1 : 1));
  const creditors = members.filter((m) => m.over > 0).map((m) => ({ owner: m.owner, left: m.over })).sort((a, b) => b.left - a.left || (a.owner < b.owner ? -1 : 1));
  const out: Transfer[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const from = debtors[d]!;
    const to = creditors[c]!;
    const cents = Math.min(from.left, to.left);
    if (cents > 0) out.push({ from: from.owner, to: to.owner, cents });
    from.left -= cents;
    to.left -= cents;
    if (from.left === 0) d++;
    if (to.left === 0) c++;
  }
  return out;
}
