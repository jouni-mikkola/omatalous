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
}

/** A pool whose month has paid 0,00 and a part of 0,00 for everyone, and no unknown payer or late correction: it has no row to list. */
export const hasNothing = (s: MonthPool): boolean =>
  s.members.every((m) => m.paid === 0 && m.owed === 0) &&
  [...s.unknownPaidBy, ...s.unknownOwedBy, ...s.unknownHolder].every((e) => e.cents === 0) &&
  s.lines.every((l) => l.kind !== "late_change");
