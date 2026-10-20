/**
 * What each member of a joint account paid in, bore and moved, month by month, for a member who sees the account (who
 * linked it or was given it). Only member ids leave the server: no IBAN, no holder's name, no row.
 */
import { sourcesByMonth } from "@banking/core";
import { accountKey } from "../db/household-repo.ts";
import { NotFound } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { settledTrace } from "./money-trace.ts";

/** One column of a month: a member, the holder who has no login (`holder`, `userId` null), or `userId` null for every part no member owns. */
interface SourceFigures {
  userId: string | null;
  holder?: true;
  paidInCents: number;
  costsCents: number;
  movedCents: number;
  takenCents: number;
  leftCents: number;
}

/** The months with a booked row, newest first. */
export interface AccountSources {
  months: { month: string; columns: SourceFigures[] }[];
}

export async function accountSources(s: Services, userId: string, accountId: string): Promise<AccountSources> {
  const account = (await s.finance(userId).getAccount(accountId)) ?? (await s.household.sharedWith(userId)).find((a) => a.id === accountId);
  if (!account) throw new NotFound("Tiliä ei löydy.");
  const t = await settledTrace(s, accountKey(account));
  // not traced (yet: the rows of a bank just linked are on their way): no months, which the page draws as nothing
  if (!t) return { months: [] };
  const members = t.users.map((u) => u.owner);
  return {
    months: sourcesByMonth(t.trace, members).map((m) => ({
      month: m.month,
      columns: m.columns.map(({ owner, ...figures }) => ({
        // the holder with no login is the user with no id: the page names them from the account's use
        userId: owner === null || owner === "u:" || owner.startsWith("m:") ? null : owner.slice(2),
        ...(owner === "u:" || owner?.startsWith("m:") ? { holder: true as const } : {}),
        ...figures,
      })),
    })),
  };
}
