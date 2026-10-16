/** What was recorded of the history asked for each account of a view, for `coverage` (the analysis context). */
import type { AccountHistory } from "@banking/core";
import { accountKey } from "../db/household-repo.ts";
import type { StoredAccount } from "../db/rows.ts";
import type { Services } from "./context.ts";

/** The sources `account_history` holds; a word outside them is no record of how the bank was asked. */
const SOURCES = new Set<string>(["default", "longest", "csv"]);

/**
 * Per account of the view, one entry for every copy of it that has a record: the viewer's own and a partner's of the
 * same joint account (same key), each under the viewer's account id.
 */
export async function historyOf(s: Services, accounts: readonly Pick<StoredAccount, "id" | "identity">[]): Promise<AccountHistory[]> {
  const rows = await s.household.historyOfKeys([...new Set(accounts.map(accountKey))]);
  return accounts.flatMap((a) =>
    rows.filter((r) => r.key === accountKey(a) && SOURCES.has(r.source)).map((r): AccountHistory => ({ accountId: a.id, askedFrom: r.askedFrom, firstRowDay: r.firstRowDay, source: r.source as AccountHistory["source"] })),
  );
}
