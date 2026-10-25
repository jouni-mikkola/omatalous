/**
 * Enable Banking as a connector: what the sync loop pulls, how its errors are told apart, and how consents
 * end. The link flow is in link.ts, the application's keys in credentials.ts and app-setup.ts.
 */
import { addDays, daysBetween, type RawTransaction } from "@banking/core";
import { UserError } from "../../platform/errors.ts";
import type { FinanceRepo } from "../../db/finance-repo.ts";
import type { Services } from "../../services/context.ts";
import type { Connector, ConnectorContext, PullWindow, Puller, RefusedRows, SyncProblem } from "../types.ts";
import { EnableBankingClient, EnableBankingError } from "./client.ts";
import { bankCapabilities, noteSeen } from "./capabilities.ts";
import { bankIdForAspsp } from "./banks.ts";
import { clientFor } from "./credentials.ts";
import { accountDetails, balanceReading, pickBalance } from "./mapper.ts";

/**
 * Shorter windows to ask for when the bank refuses the period. Nordea keeps two years of an account's rows but
 * answers one card request for at most 12 months, and only 90 days without a fresh consent.
 */
const FALLBACK_DAYS = [360, 89] as const;

/** The bank refused the request itself (400 or 422), not the consent or the application. */
function refused(err: unknown): err is EnableBankingError {
  return err instanceof EnableBankingError && (err.status === 400 || err.status === 422) && !err.consentExpired && !err.appRejected && !err.notLinked;
}

/** What a fetch was in the end answered for: the first day, and whether it was the bank's longest history. */
type Asked = { dateFrom: string; longest: boolean };

/**
 * The rows since the window's start, then shorter windows when the bank refuses a period that reaches back too far.
 * Rows the bank does not keep are lost either way; a refusal would also lose the ones it does. `unread` keeps the
 * counts of unreadable rows of the answer kept and `asked` the window that was answered, which is what the account's
 * history record must say (a card that fell back to 360 days was not asked for two years).
 */
async function fetchTransactions(client: EnableBankingClient, uid: string, window: PullWindow, today: string, userHeaders: Readonly<Record<string, string>> | undefined, unread: Map<string, RefusedRows>, asked: Map<string, Asked>) {
  const counted = (rows: RawTransaction[], counts: RefusedRows, answered: Asked) => {
    unread.set(uid, counts);
    asked.set(uid, answered);
    return rows;
  };
  try {
    const counts: RefusedRows = {};
    return counted(await client.transactions(uid, window.dateFrom, window.initial ? "longest" : "default", userHeaders, counts), counts, { dateFrom: window.dateFrom, longest: window.initial });
  } catch (err) {
    if (!refused(err)) throw err;
    for (const days of FALLBACK_DAYS) {
      const dateFrom = addDays(today, -days);
      if (dateFrom <= window.dateFrom) continue;
      try {
        const counts: RefusedRows = {};
        return counted(await client.transactions(uid, dateFrom, "default", userHeaders, counts), counts, { dateFrom, longest: false });
      } catch (retry) {
        if (!refused(retry)) throw retry;
      }
    }
    throw err;
  }
}

/**
 * The rows of a backfill window (`dateTo` set), one plain window. A bank that refuses it may still give its days within
 * a shorter reach (Nordea gives 90 days without a fresh consent), so those are asked once more and the window ends
 * there. Its unreadable rows are not counted over those of the ordinary fetch.
 */
async function fetchOlder(client: EnableBankingClient, uid: string, window: PullWindow & { dateTo: string }, today: string, userHeaders: Readonly<Record<string, string>> | undefined, asked: Map<string, Asked>) {
  try {
    const rows = await client.transactions(uid, window.dateFrom, "default", userHeaders, {}, window.dateTo);
    asked.set(uid, { dateFrom: window.dateFrom, longest: false });
    return rows;
  } catch (err) {
    if (!refused(err)) throw err;
    for (const days of FALLBACK_DAYS) {
      const dateFrom = addDays(today, -days);
      if (dateFrom <= window.dateFrom) continue;
      if (dateFrom >= window.dateTo) break;
      try {
        const rows = await client.transactions(uid, dateFrom, "default", userHeaders, {}, window.dateTo);
        asked.set(uid, { dateFrom, longest: false });
        return rows;
      } catch (retry) {
        if (!refused(retry)) throw retry;
      }
    }
    throw err;
  }
}

async function open({ s, repo, userHeaders }: ConnectorContext): Promise<Puller> {
  const client = await clientFor(s, repo.userId);
  // the bank of an account, by the consent it belongs to; read once, on the first fetch that has facts to keep
  let banks: Map<string, string | null> | undefined;
  const bankOf = async (externalId: string): Promise<string | null> => {
    if (!banks) {
      const consents = new Map((await repo.listConnections()).map((c) => [c.id, bankIdForAspsp(c.institution)]));
      banks = new Map((await repo.listAccounts()).map((a) => [a.externalId ?? "", consents.get(a.connectionId ?? "") ?? null]));
    }
    return banks.get(externalId) ?? null;
  };
  // the member's headers for an account, built with its bank's own list (default pair: no record, unknown bank, or a list that cannot be read)
  let lists: Map<string, string[] | null> | undefined;
  const headersFor = async (externalId: string): Promise<Readonly<Record<string, string>> | undefined> => {
    if (!userHeaders) return undefined;
    try {
      lists ??= new Map((await bankCapabilities(s)).map((c) => [c.bankId, c.requiredPsuHeaders]));
      const bank = await bankOf(externalId);
      return userHeaders((bank && lists.get(bank)) || null) ?? undefined;
    } catch {
      return userHeaders(null) ?? undefined;
    }
  };
  // per account, the rows of its last fetch the mapper could not read
  const refused = new Map<string, RefusedRows>();
  const askedOf = new Map<string, Asked>();
  return {
    attended: async (account) => (await headersFor(account.externalId)) !== undefined,
    refused: (account) => refused.get(account.externalId) ?? {},
    asked: (account) => askedOf.get(account.externalId),
    async transactions(account, window) {
      const headers = await headersFor(account.externalId);
      const rows = window.dateTo ? await fetchOlder(client, account.externalId, { ...window, dateTo: window.dateTo }, s.today(), headers, askedOf) : await fetchTransactions(client, account.externalId, window, s.today(), headers, refused, askedOf);
      const oldest = rows.reduce<string | null>((o, r) => (o === null || r.bookingDate < o ? r.bookingDate : o), null);
      await noteSeen(s, await bankOf(account.externalId).catch(() => null), {
        pending: rows.some((r) => r.status === "pending"),
        ...(oldest ? { historyDays: daysBetween(oldest, s.today()) } : {}),
      });
      return rows;
    },
    async balance(account) {
      const balances = await client.balances(account.externalId, await headersFor(account.externalId));
      await noteSeen(s, await bankOf(account.externalId).catch(() => null), { balanceTypes: Array.isArray(balances) ? balances.map((b) => b?.balance_type) : [] });
      // every balance the bank sent, the one it shows first
      const shown = pickBalance(balances);
      return [...(shown ? [shown] : []), ...balances.filter((b) => b !== shown)].flatMap((b) => balanceReading(b) ?? []);
    },
    async details(account) {
      return accountDetails(await client.accountDetails(account.externalId));
    },
  };
}

/** The words for an account a restricted application may not read, after the account's name. */
export const NOT_LINKED_MESSAGE = "tiliä ei ole lisätty Enable Bankingissa. Ylläpitäjän pitää lisätä se kohdassa API applications > Omatalous > Link accounts.";

function classify(err: unknown): SyncProblem | null {
  if (!(err instanceof EnableBankingError)) return null;
  if (err.notLinked) return { kind: "not_linked", message: NOT_LINKED_MESSAGE };
  if (err.appRejected) {
    return { kind: "app_rejected", message: `Enable Banking hylkäsi avaimen (${err.status}). Ylläpitäjä voi tarkistaa sen kohdassa Asetukset > Palvelin > Testaa yhteys.` };
  }
  if (err.consentExpired) return { kind: "consent_expired" };
  // the bank's response text is not for the user's screen, only its status
  return { kind: "upstream", message: `pankki vastasi virheellä ${err.status}${err.code ? ` (${err.code})` : ""}`, rateLimited: err.rateLimited };
}

export const enableBanking: Connector = {
  id: "enablebanking",
  sync: { open, classify },
  revokeAll: revokeAllConnections,
};

export async function removeConnection(s: Services, repo: FinanceRepo, id: string): Promise<void> {
  if (!(await repo.listConnections()).some((c) => c.id === id)) throw new UserError("Yhteyttä ei löydy.");
  try {
    await (await clientFor(s, repo.userId)).deleteSession(id);
  } catch (err) {
    // already gone at the bank (or no credentials any more): still revoke locally
    if (!(err instanceof EnableBankingError) && !(err instanceof UserError)) throw err;
  }
  await repo.setConnectionStatus(id, "revoked");
}

/**
 * Ends every active bank consent of a user at Enable Banking, for a member who is being removed. Best
 * effort: a consent already gone, or one that cannot be reached, counts as failed and the removal goes on.
 */
async function revokeAllConnections(s: Services, userId: string): Promise<{ revoked: number; failed: number }> {
  const repo = s.finance(userId);
  const active = (await repo.listConnections()).filter((c) => c.status === "active" && c.provider === enableBanking.id);
  const result = { revoked: 0, failed: 0 };
  if (!active.length) return result;
  let client: EnableBankingClient | null = null;
  try {
    client = await clientFor(s, userId);
  } catch {
    // no credentials any more
  }
  for (const c of active) {
    try {
      if (!client) throw new Error("no client");
      await client.deleteSession(c.id);
      result.revoked++;
    } catch (err) {
      result.failed++;
      console.error(`revoke consent ${c.id.slice(0, 8)}:`, err instanceof EnableBankingError ? err.message : "failed");
    }
  }
  return result;
}
