/**
 * Account edits, removals and sharing. Each use case picks what the change invalidates: a reprocess when the rows'
 * flows can change, a bump of the user's data version when only the account list did, and both members' versions for
 * a share.
 */
import { type AccountType, daysBetween } from "@banking/core";
import { type FetchProblem, readFetchProblems } from "../connectors/fetch-problems.ts";
import { readRefusedRows } from "../connectors/refused-rows.ts";
import type { RefusedRows } from "../connectors/types.ts";
import type { Connection, StoredAccount } from "../db/rows.ts";
import { todayIn } from "../platform/config.ts";
import { NotFound, UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { reprocess } from "./enrich.ts";
import { EXTENSIONS } from "../extensions.ts";

/**
 * How a consent stands, in one word the table, Tietojen laatu and the notices all read:
 * - active: in use, through its last day;
 * - lapsed: its date passed ("vanhentui 9.4.2027"), also before the next fetch writes the status;
 * - broken: closed before its date by the bank or Enable Banking ("katkesi"); the date ahead means nothing now;
 * - removed: ended by the user (or replaced by a newer consent, which leaves it without accounts).
 */
export type ConnectionState = "active" | "lapsed" | "broken" | "removed";

/** The day a consent ends (YYYY-MM-DD) in the instance time zone: the day the page shows for it, whatever hour the bank ends it. */
export function consentEnd(validUntil: string | null, timezone: string): string | null {
  if (!validUntil) return null;
  const at = new Date(validUntil);
  return Number.isNaN(at.getTime()) ? validUntil.slice(0, 10) : todayIn(timezone, at);
}

export function connectionState(conn: Pick<Connection, "status" | "validUntil">, today: string, timezone: string): ConnectionState {
  const end = consentEnd(conn.validUntil, timezone);
  if (conn.status === "revoked") return "removed";
  // an expired status on its last day ended that day; an active one is still in use that day
  if (end !== null && (conn.status === "active" ? end < today : end <= today)) return "lapsed";
  return conn.status === "expired" ? "broken" : "active";
}

/**
 * A consent as the settings and the notices show it. One that owns no account is history: its accounts moved to a
 * newer consent, or it never had any. The settings do not list it and it has no notice; its stored row stays.
 *
 * `replaced`: it is not active and a newer consent of the same bank is. The accounts still on it did not come with the
 * new consent: a restricted application leaves out of a session every account that is not under Linked accounts, so
 * connecting again moves them only after they are linked in the Control Panel. They are named one by one instead of
 * the bank-wide "katkesi".
 */
export function connectionView(conn: Connection, today: string, timezone: string, accounts: readonly Pick<StoredAccount, "connectionId">[], connections: readonly Connection[]) {
  const end = consentEnd(conn.validUntil, timezone);
  const state = connectionState(conn, today, timezone);
  const replaced =
    state !== "active" &&
    connections.some((o) => o.id !== conn.id && o.provider === conn.provider && o.institution === conn.institution && o.createdAt >= conn.createdAt && connectionState(o, today, timezone) === "active");
  return {
    ...conn,
    status: state === "lapsed" ? ("expired" as const) : conn.status,
    state,
    history: !accounts.some((a) => a.connectionId === conn.id),
    replaced,
    // its session or date ended: no fetch is made on it until the member connects again, and nothing stored is deleted
    needsRenewal: state === "lapsed" || state === "broken",
    daysLeft: state !== "active" || end === null ? null : Math.max(0, daysBetween(today, end)),
  };
}

/** Each account with what its last fetch ran into (fetch-problems.ts) and the rows it could not read (refused-rows.ts), or null. */
export async function accountsView<A extends Pick<StoredAccount, "id">>(s: Services, userId: string, accounts: readonly A[]): Promise<(A & { problem: FetchProblem | null; refused: RefusedRows | null })[]> {
  const [problems, refused] = await Promise.all([readFetchProblems(s, userId), readRefusedRows(s, userId)]);
  return accounts.map((a) => ({ ...a, problem: Object.hasOwn(problems, a.id) ? problems[a.id]! : null, refused: Object.hasOwn(refused, a.id) ? refused[a.id]! : null }));
}

/**
 * What the route checked: the user's own name ("" takes it away, so the bank's shows again), a type from
 * ACCOUNT_TYPES, a balance in whole cents.
 */
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
  if (renamed) {
    // the user's name is stored apart from the bank's: a link rewrites the bank's, never this one
    const name = edit.name?.trim().slice(0, 80);
    await repo.updateAccount(id, { customName: name === undefined ? undefined : name && name !== account.bankName ? name : null, type: edit.type });
  }
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
  for (const e of EXTENSIONS) await e.removeDemo?.(s, userId);
  await reprocess(repo, s.settings);
}
