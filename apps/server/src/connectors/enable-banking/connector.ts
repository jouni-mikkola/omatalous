/**
 * Enable Banking as a connector: what the sync loop pulls, how its errors are told apart, and how consents
 * end. The link flow is in link.ts, the application's keys in credentials.ts and app-setup.ts.
 */
import { UserError } from "../../platform/errors.ts";
import type { FinanceRepo } from "../../db/finance-repo.ts";
import type { Services } from "../../services/context.ts";
import type { Connector, ConnectorContext, Puller, SyncProblem } from "../types.ts";
import { EnableBankingClient, EnableBankingError } from "./client.ts";
import { clientFor } from "./credentials.ts";
import { amountToCents, pickBalance } from "./mapper.ts";

async function open({ s, repo }: ConnectorContext): Promise<Puller> {
  const client = await clientFor(s, repo.userId);
  return {
    transactions: (account, window) => client.transactions(account.externalId, window.dateFrom, window.initial ? "longest" : "default"),
    async balance(account) {
      const balance = pickBalance(await client.balances(account.externalId));
      return balance ? amountToCents(balance.balance_amount.amount) : null;
    },
  };
}

function classify(err: unknown): SyncProblem | null {
  if (!(err instanceof EnableBankingError)) return null;
  if (err.appRejected) {
    return { kind: "app_rejected", message: `Enable Banking hylkäsi avaimen (${err.status}). Ylläpitäjä voi tarkistaa sen kohdassa Asetukset > Palvelin > Testaa yhteys.` };
  }
  if (err.consentExpired) return { kind: "consent_expired" };
  // the bank's response text is not for the user's screen, only its status
  return { kind: "upstream", message: `pankki vastasi virheellä ${err.status}` };
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
