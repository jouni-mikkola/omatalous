/**
 * "Täsmää pankin saldoon" for the accounts of a view: the stored rows of each account against the balances the bank sent
 * (`reconcile`, core). Read-only, worked out on every read and never stored. The answer is for an account the viewer
 * sees, from that account row's own rows and history and the whole account's balances and rows in another currency.
 */
import { compactReconcile, reconcile, type ReconcileBalance, type ReconcileResult } from "@banking/core";
import { accountKey } from "../db/household-repo.ts";
import type { StoredAccount } from "../db/rows.ts";
import type { Services } from "./context.ts";

type Seen = Pick<StoredAccount, "id" | "userId" | "identity" | "type" | "currency">;

/**
 * Per account given, its result, or null for one that is not reconciled (a card, a loan, another currency). The caller
 * hands over only accounts the viewer may see: the rows of an account shared with the viewer are read as the owner's.
 */
export async function reconcileOf(s: Services, viewerId: string, accounts: readonly Seen[]): Promise<Map<string, ReconcileResult | null>> {
  const out = new Map<string, ReconcileResult | null>();
  const repo = s.finance(viewerId);
  const keys = [...new Set(accounts.map(accountKey))];
  const [balances, foreign, asked] = await Promise.all([repo.balancesOf(keys), repo.foreignRowsOf(keys), repo.askedFromOf(accounts.map((a) => a.id))]);
  const today = s.today();
  const work = (a: Seen, rows: Parameters<typeof reconcile>[1], own: ReconcileBalance[], historyFrom: string | null, foreignDays: string[]) => {
    const result = reconcile(a, rows, own, { historyFrom, foreignDays, today });
    return result && compactReconcile(result);
  };
  for (const a of accounts) {
    const key = accountKey(a);
    const own: ReconcileBalance[] = balances.filter((b) => b.key === key);
    // an account with fewer than two balances has no interval, so its rows are not read to say why
    if (own.length < 2) {
      out.set(a.id, work(a, [], own, null, []));
      continue;
    }
    const from = own.reduce((day, b) => (b.referenceDate !== null && b.referenceDate < day ? b.referenceDate : day), own[0]!.day);
    const { rows, firstDay } = await s.finance(a.userId).bookedRowsFrom(a.id, from);
    out.set(a.id, work(a, rows, own, asked.get(a.id) ?? firstDay, foreign.filter((f) => f.accountKey === key).map((f) => f.bookingDate)));
  }
  return out;
}
