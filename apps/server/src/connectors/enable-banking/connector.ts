/**
 * Enable Banking as a connector: what the sync loop pulls, how its errors are told apart, and how consents
 * end. The link flow is in link.ts, the application's keys in credentials.ts and app-setup.ts.
 */
import { addDays } from "@banking/core";
import { UserError } from "../../platform/errors.ts";
import type { FinanceRepo } from "../../db/finance-repo.ts";
import type { Services } from "../../services/context.ts";
import type { Connector, ConnectorContext, PullWindow, Puller, SyncProblem } from "../types.ts";
import { EnableBankingClient, EnableBankingError } from "./client.ts";
import { clientFor } from "./credentials.ts";
import { accountDetails, amountToCents, pickBalance } from "./mapper.ts";
import type { EbAccount, EbBalance } from "./types.ts";

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

/** What a just-linked account's own answer had, kept until its first balances answer: one log line then tells both. */
interface LinkedShape {
  bank: string;
  type: string;
  limit: boolean;
}
const linked = new WeakMap<object, Map<string, LinkedShape>>();
/** A link that is never fetched must not grow the map: past this the oldest note goes. */
const LINKED_MAX = 100;

/**
 * A code of the bank's answer as the log may show it: four capital letters, the shape of every code Enable Banking
 * documents for both fields (CACC, CARD, CLBD, ITAV). Never a name, a number or free text.
 */
function logCode(value: unknown): string {
  if (value === null || value === undefined) return "none";
  return typeof value === "string" && /^[A-Z]{4}$/.test(value) ? value : "other";
}

/**
 * Remembers what the bank sent for an account at link, by the account's uid (new with every consent). The line is
 * written when the first fetch reads the balances (logLinkedAccount), so linking costs no extra call to the bank.
 */
export function noteLinkedAccount(s: Services, bankId: string | null, a: EbAccount): void {
  const notes = linked.get(s) ?? new Map<string, LinkedShape>();
  linked.set(s, notes);
  if (notes.size >= LINKED_MAX) notes.delete(notes.keys().next().value!);
  notes.set(a.uid, { bank: bankId ?? "unknown", type: logCode(a.cash_account_type), limit: a.credit_limit !== null && a.credit_limit !== undefined });
}

/**
 * One line per account after a link, to learn what each bank sends: the bank's id, `cash_account_type`, whether a
 * `credit_limit` came and the balance types. Codes and yes or no only: never an IBAN, a name, an amount or the answer itself.
 */
function logLinkedAccount(s: Services, uid: string, balances: unknown): void {
  const notes = linked.get(s);
  const note = notes?.get(uid);
  if (!notes || !note) return;
  notes.delete(uid);
  const types = Array.isArray(balances) ? [...new Set(balances.map((b: EbBalance | null) => logCode(b?.balance_type)))].sort() : [];
  console.log(`bank link ${note.bank}: cash_account_type=${note.type} credit_limit=${note.limit ? "yes" : "no"} balance_types=${types.join(",") || "none"}`);
}

async function open({ s, repo }: ConnectorContext): Promise<Puller> {
  const client = await clientFor(s, repo.userId);
  return {
    transactions: (account, window) => fetchTransactions(client, account.externalId, window, s.today()),
    async balance(account) {
      const balances = await client.balances(account.externalId);
      logLinkedAccount(s, account.externalId, balances);
      const balance = pickBalance(balances);
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
