/**
 * The rows in another currency than the euro, for the readers: the day walk (the newest such day of each account in a
 * view) and Asetukset > Tilit (per account, per currency, the count, the total and the newest rows). Rows are kept by real
 * account, so everyone who can see one copy of an account sees the same rows.
 */
import { type ForeignDay, type ForeignTotal, foreignTotals } from "@banking/core";
import { accountKey } from "../db/household-repo.ts";
import type { StoredAccount } from "../db/rows.ts";
import type { Services } from "./context.ts";

type Held = Pick<StoredAccount, "id" | "identity">;

/** How many of the newest rows of one currency the page lists: the count above them says how many there are. */
const LISTED = 20;

/** Per account that has rows in another currency: how many and the newest day. */
export async function foreignDaysOf(s: Services, userId: string, accounts: readonly Held[]): Promise<ForeignDay[]> {
  const rows = await s.finance(userId).foreignRowsOf([...new Set(accounts.map(accountKey))]);
  const byKey = new Map<string, { count: number; newestDay: string }>();
  for (const r of rows) {
    const held = byKey.get(r.accountKey);
    if (!held) byKey.set(r.accountKey, { count: 1, newestDay: r.bookingDate });
    else {
      held.count++;
      if (r.bookingDate > held.newestDay) held.newestDay = r.bookingDate;
    }
  }
  return accounts.flatMap((a) => {
    const held = byKey.get(accountKey(a));
    return held ? [{ accountId: a.id, ...held }] : [];
  });
}

/** One currency of an account: its count and total, and its newest rows. */
interface ForeignCurrencyView extends ForeignTotal {
  rows: { day: string; amountMinor: number; scale: number; text: string | null }[];
}

/** The accounts given (the viewer's own and those shared with them) that have rows in another currency, by account id. */
export async function foreignRowsView(s: Services, userId: string, accounts: readonly Held[]): Promise<Record<string, ForeignCurrencyView[]>> {
  const rows = await s.finance(userId).foreignRowsOf([...new Set(accounts.map(accountKey))]);
  const out: Record<string, ForeignCurrencyView[]> = {};
  for (const a of accounts) {
    const mine = rows.filter((r) => r.accountKey === accountKey(a));
    if (!mine.length) continue;
    out[a.id] = foreignTotals(mine).map((t) => ({
      ...t,
      rows: mine.filter((r) => r.currency === t.currency).slice(0, LISTED).map((r) => ({ day: r.bookingDate, amountMinor: r.amountMinor, scale: r.scale, text: r.text })),
    }));
  }
  return out;
}
