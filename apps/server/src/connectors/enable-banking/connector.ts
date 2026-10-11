/**
 * Enable Banking as a connector: what the sync loop pulls, how its errors are told apart, and how consents
 * end. The link flow is in link.ts, the application's keys in credentials.ts and app-setup.ts.
 */
import { addDays } from "@banking/core";
import { NotFound, UserError } from "../../platform/errors.ts";
import type { FinanceRepo } from "../../db/finance-repo.ts";
import type { Services } from "../../services/context.ts";
import type { Connector, ConnectorContext, PullWindow, Puller, SyncProblem } from "../types.ts";
import { EnableBankingClient, EnableBankingError } from "./client.ts";
import { clientFor } from "./credentials.ts";
import { accountDetails, amountToCents, pickBalance } from "./mapper.ts";

/**
 * Shorter windows to ask for when the bank refuses the period. Nordea keeps two years of an account's rows but
 * answers one card request for at most 12 months, and only 90 days without a fresh consent.
 */
const FALLBACK_DAYS = [360, 89] as const;

/** The bank refused the request itself (400 or 422), not the consent or the application. */
function refused(err: unknown): err is EnableBankingError {
  return err instanceof EnableBankingError && (err.status === 400 || err.status === 422) && !err.consentExpired && !err.appRejected && !err.notLinked;
}

/**
 * The window the loop asks for, then shorter ones when the bank refuses a period that reaches back too far. Rows
 * the bank does not keep are lost either way; a refusal would also lose the ones it does.
 */
async function fetchTransactions(client: EnableBankingClient, uid: string, window: PullWindow, today: string) {
  try {
    return await client.transactions(uid, window.dateFrom, window.initial ? "longest" : "default");
  } catch (err) {
    if (!refused(err)) throw err;
    for (const days of FALLBACK_DAYS) {
      const dateFrom = addDays(today, -days);
      if (dateFrom <= window.dateFrom) continue;
      try {
        return await client.transactions(uid, dateFrom, "default");
      } catch (retry) {
        if (!refused(retry)) throw retry;
      }
    }
    throw err;
  }
}

async function open({ s, repo }: ConnectorContext): Promise<Puller> {
  const client = await clientFor(s, repo.userId);
  return {
    transactions: (account, window) => fetchTransactions(client, account.externalId, window, s.today()),
    async balance(account) {
      const balance = pickBalance(await client.balances(account.externalId));
      return balance ? amountToCents(balance.balance_amount.amount) : null;
    },
    async details(account) {
      return accountDetails(await client.accountDetails(account.externalId));
    },
  };
}

/** The words for an account a restricted application may not read, after the account's name. */
export const NOT_LINKED_MESSAGE = "tiliä ei ole linkitetty Enable Bankingissa. Ylläpitäjä lisää sen kohdassa API applications > Omatalous > Link accounts.";

function classify(err: unknown): SyncProblem | null {
  if (!(err instanceof EnableBankingError)) return null;
  if (err.notLinked) return { kind: "not_linked", message: NOT_LINKED_MESSAGE };
  if (err.appRejected) {
    return { kind: "app_rejected", message: `Enable Banking hylkäsi avaimen (${err.status}). Ylläpitäjä voi tarkistaa sen kohdassa Asetukset > Palvelin > Testaa yhteys.` };
  }
  if (err.consentExpired) return { kind: "consent_expired" };
  // the bank's response text is not for the user's screen, only its status
  return { kind: "upstream", message: `pankki vastasi virheellä ${err.status}${err.code ? ` (${err.code})` : ""}` };
}

export const enableBanking: Connector = {
  id: "enablebanking",
  label: "Enable Banking",
  kind: "psd2",
  sync: { replacePending: true, open, classify },
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
 * Takes a connection that owns no account off the list ("Poista listalta"). One that still owns an account stays:
 * its accounts would lose the line that says why they are not fetched. A consent still open at the bank is ended
 * there first, best effort.
 */
export async function forgetConnection(s: Services, repo: FinanceRepo, id: string): Promise<void> {
  const conn = (await repo.listConnections()).find((c) => c.id === id);
  if (!conn) throw new NotFound("Yhteyttä ei löydy.");
  const owns = "Yhteydellä on tilejä, joten se pysyy listalla.";
  if ((await repo.listAccounts()).some((a) => a.connectionId === id)) throw new UserError(owns);
  if (conn.status === "active" && conn.provider === enableBanking.id) {
    try {
      await (await clientFor(s, repo.userId)).deleteSession(id);
    } catch (err) {
      if (!(err instanceof EnableBankingError) && !(err instanceof UserError)) throw err;
    }
  }
  // the statement checks again, so an account linked to it meanwhile keeps its connection
  if (!(await repo.deleteConnectionWithoutAccounts(id))) throw new UserError(owns);
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
