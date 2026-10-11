/**
 * Account edits, removals and sharing. Each use case picks what the change invalidates: a reprocess when the rows'
 * flows can change, a bump of the user's data version when only the account list did, and both members' versions for
 * a share.
 */
import { type AccountType, daysBetween } from "@banking/core";
import type { Connection } from "../db/rows.ts";
import { NotFound, UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { reprocess } from "./enrich.ts";

/** Past its end date a consent shows as expired before the next fetch writes that status. */
export function connectionView(conn: Connection, today: string) {
  const end = conn.validUntil?.slice(0, 10) ?? null;
  return {
    ...conn,
    status: conn.status === "active" && end !== null && end < today ? ("expired" as const) : conn.status,
    daysLeft: end === null ? null : Math.max(0, daysBetween(today, end)),
  };
}

/** What the route checked: a new name, a type from ACCOUNT_TYPES, a balance in whole cents. */
export interface AccountEdit {
  name?: string;
  type?: AccountType;
  balanceCents?: number;
}

export async function updateAccount(s: Services, userId: string, id: string, edit: AccountEdit) {
  const repo = s.finance(userId);
  const account = await repo.getAccount(id);
  if (!account) throw new NotFound("Tiliä ei löydy.");
  // a bank-linked account gets its balance from the bank at every sync
  if (edit.balanceCents !== undefined && account.provider !== "csv") throw new UserError("Saldon voi asettaa vain tuodulle tilille.");
  const renamed = edit.name !== undefined || edit.type !== undefined;
  if (renamed) await repo.updateAccount(id, { name: edit.name?.trim().slice(0, 80) || undefined, type: edit.type });
  if (edit.balanceCents !== undefined) await repo.setAccountBalance(id, edit.balanceCents, s.now().toISOString());
  // account type and a card's name decide whether a card bill is a transfer; a balance touches only the account list
  if (renamed) await reprocess(repo, s.settings);
  else await s.settings.bumpUserDataVersion(userId);
  return repo.getAccount(id);
}

/** Imported and demo accounts only: a bank-linked one would come back at the next sync. */
export async function deleteAccount(s: Services, userId: string, id: string): Promise<void> {
  const repo = s.finance(userId);
  // another member's account looks the same as a missing one
  const account = await repo.getAccount(id);
  if (!account) throw new NotFound("Tiliä ei löydy.");
  if (account.provider !== "csv" && account.provider !== "demo") throw new UserError("Pankkiyhteyden tiliä ei voi poistaa.");
  await repo.deleteAccount(account.id);
  // transfers that paired with the removed rows are counted again
  await reprocess(repo, s.settings);
}

/** The owner's and the viewer's analyses change, nobody else's. */
export async function shareAccount(s: Services, ownerId: string, accountId: string, viewerId: string): Promise<void> {
  if (!(await s.household.share(ownerId, accountId, viewerId))) throw new UserError("Tiliä ei voi jakaa.");
  await Promise.all([ownerId, viewerId].map((id) => s.settings.bumpUserDataVersion(id)));
}

export async function unshareAccount(s: Services, ownerId: string, accountId: string, viewerId: string): Promise<void> {
  await s.household.unshare(ownerId, accountId, viewerId);
  await Promise.all([ownerId, viewerId].map((id) => s.settings.bumpUserDataVersion(id)));
}

/** The demo rows go; transfers and series that leaned on them are worked out again. */
export async function removeDemoData(s: Services, userId: string): Promise<void> {
  const repo = s.finance(userId);
  await repo.deleteProviderData("demo");
  await reprocess(repo, s.settings);
}
