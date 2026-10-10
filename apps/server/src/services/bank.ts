/**
 * Linking banks and fetching transactions, per user. Each user uses either
 * their own Enable Banking application (stored encrypted) or the household's
 * shared one (set up by an admin in the browser, see bank-app.ts).
 */
import { addDays, fold, normalizeIban, originFromRelayState, parseLocalOrigin, relayState } from "@banking/core";
import type { EnableBankingConfig } from "../config.ts";
import type { FinanceRepo } from "../db/finance-repo.ts";
import { EnableBankingClient, EnableBankingError } from "../providers/enable-banking/client.ts";
import { accountName, accountType, amountToCents, pickBalance } from "../providers/enable-banking/mapper.ts";
import { canonicalPrivateKey, KeyProblem } from "../security/private-key.ts";
import { instanceCredentials, parseAppId } from "./bank-app.ts";
import { bankById, DEFAULT_BANK } from "./banks.ts";
import type { Services } from "./context.ts";
import { reprocess } from "./enrich.ts";
import { randomToken, stableId } from "./ids.ts";
import { startLookup } from "./industry.ts";
import { ingestTransactions } from "./ingest.ts";
import { UserError } from "./errors.ts";

/** "2026-09-30" → "30.9.2026" */
const finnishDate = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;

export { UserError };

// ── credentials ──────────────────────────────────────────

export interface ResolvedCredentials extends EnableBankingConfig {
  source: "user" | "instance";
}

export async function resolveCredentials(s: Services, userId: string): Promise<ResolvedCredentials | null> {
  const own = await s.users.getBankCredentials(userId);
  if (own) {
    const box = await s.secretBox();
    if (!box) throw new UserError("Pankkiavainta ei voi avata. Pyydä ylläpitäjää tarkistamaan palvelimen loki.");
    return { appId: own.appId, privateKeyPem: await box.open(own.privateKeyEnc, userId), source: "user" };
  }
  const shared = await instanceCredentials(s);
  return shared ? { appId: shared.appId, privateKeyPem: shared.privateKeyPem, source: "instance" } : null;
}

/** Validates and stores a member's own Enable Banking app id + private key (encrypted, re-encoded). */
export async function saveCredentials(s: Services, userId: string, appIdInput: unknown, privateKeyInput: unknown): Promise<void> {
  const box = await s.secretBox();
  if (!box) throw new UserError("Avaimia ei voi nyt tallentaa. Pyydä ylläpitäjää tarkistamaan palvelimen loki.");
  const appId = parseAppId(appIdInput);
  let pem: string;
  try {
    pem = await canonicalPrivateKey(privateKeyInput);
  } catch (err) {
    if (err instanceof KeyProblem) throw new UserError(err.message);
    throw err;
  }
  await s.users.setBankCredentials(userId, appId, await box.seal(pem, userId));
}

async function clientFor(s: Services, userId: string): Promise<EnableBankingClient> {
  const creds = await resolveCredentials(s, userId);
  if (!creds) throw new UserError("Pankkiyhteydet eivät ole vielä käytössä. Pyydä ylläpitäjää ottamaan ne käyttöön kohdassa Asetukset > Palvelin.");
  return new EnableBankingClient({ appId: creds.appId, privateKeyPem: creds.privateKeyPem, fetch: s.fetch, authHosts: s.config.bank.authHosts });
}

// ── linking a bank ───────────────────────────────────────

const STATE_PREFIX = "auth_state:";
const STATE_TTL_MS = 60 * 60_000;

/** The bank's redirect came back with an unknown, used or old state; the callback tells the user to start again. */
export class AuthStateExpired extends UserError {}

/**
 * The state for the bank. In relay mode it carries the local address the return page forwards to: the one the
 * browser used (`returnTo`), else the configured address, and only if it is a private or local origin.
 */
function stateFor(s: Services, returnTo: unknown): string {
  const token = randomToken();
  if (s.redirectMode() !== "relay" || s.config.bank.redirectUrl) return token;
  const origin =
    (typeof returnTo === "string" ? parseLocalOrigin(returnTo) : null) ?? parseLocalOrigin(s.instance.current.appBaseUrl);
  if (!origin) {
    throw new UserError("Avaa Omatalous kotiverkon osoitteella, esimerkiksi http://192.168.1.10:8080, tai ota käyttöön oma https-osoite kohdassa Asetukset > Palvelin.");
  }
  return relayState(token, origin);
}

/** Step 1: returns the bank's consent page URL. Only banks in the registry (banks.ts) can be started. */
export async function startConnection(s: Services, userId: string, bankId: unknown = DEFAULT_BANK.id, returnTo?: unknown): Promise<{ url: string }> {
  const bank = bankById(bankId);
  if (!bank) throw new UserError("Tuntematon pankki.");
  const client = await clientFor(s, userId);
  const country = bank.country;

  const aspsp = (await client.listAspsps(country)).find((a) => a.name.toLowerCase() === bank.aspspName.toLowerCase());
  if (!aspsp) throw new UserError(`Pankkia ${bank.name} (${country}) ei löytynyt Enable Bankingista.`);
  const seconds = Math.min(s.config.bank.consentDays * 86_400, aspsp.maximum_consent_validity ?? Number.POSITIVE_INFINITY);

  // the state ties the bank's redirect to this user: another user cannot complete it
  const state = stateFor(s, returnTo);
  await s.settings.set(`${STATE_PREFIX}${state}`, JSON.stringify({ userId, createdAt: s.now().getTime() }));
  try {
    const { url } = await client.startAuthorization({
      aspspName: aspsp.name,
      country,
      redirectUrl: s.redirectUrl(),
      state,
      validUntil: new Date(s.now().getTime() + seconds * 1000 - 60_000),
      psuType: bank.psuType,
    });
    return { url };
  } catch (err) {
    await s.settings.delete(`${STATE_PREFIX}${state}`);
    if (err instanceof EnableBankingError && (/REDIRECT_URI_NOT_ALLOWED/.test(err.message) || (err.status === 422 && /redirect/i.test(err.body)))) {
      throw new UserError(`Enable Banking ei hyväksy paluuosoitetta. Lisää sovelluksen Redirect URLs -kohtaan: ${s.redirectUrl()}`);
    }
    throw err;
  }
}

/** Step 2: the bank redirected back with `code` and `state`. */
export async function completeConnection(s: Services, repo: FinanceRepo, code: string, state: string): Promise<{ connectionId: string; accounts: number }> {
  const key = `${STATE_PREFIX}${state}`;
  // a state that names a return address must still name a private one (the page and the server both check)
  if (state.includes(".") && !originFromRelayState(state)) throw new AuthStateExpired("Yhdistäminen vanheni. Yritä uudelleen.");
  const raw = await s.settings.get(key);
  // single use: consumed by the first attempt, even a failed or foreign one
  if (raw) await s.settings.delete(key);
  const pending = raw ? (JSON.parse(raw) as { userId: string; createdAt: number }) : null;
  if (!pending || pending.userId !== repo.userId || s.now().getTime() - pending.createdAt > STATE_TTL_MS) {
    throw new AuthStateExpired("Yhdistäminen vanheni. Yritä uudelleen.");
  }

  const session = await (await clientFor(s, repo.userId)).createSession(code);
  await repo.upsertConnection({
    id: session.session_id,
    provider: "enablebanking",
    institution: session.aspsp.name,
    country: session.aspsp.country,
    status: "active",
    validUntil: session.access.valid_until,
    createdAt: s.now().toISOString(),
    lastSyncedAt: null,
  });

  for (const a of session.accounts) {
    // account uids change with every consent; the identification hash / IBAN do not
    const identity = await stableId(a.identification_hash ?? a.account_id?.iban ?? a.uid);
    await repo.upsertAccount({
      id: `eb-${await stableId(`${repo.userId}|${identity}`)}`,
      connectionId: session.session_id,
      provider: "enablebanking",
      externalId: a.uid,
      identity,
      name: accountName(a),
      iban: a.account_id?.iban ?? null,
      currency: a.currency ?? "EUR",
      type: accountType(a),
    });
  }

  await foldCsvAccounts(repo);

  // older consents whose accounts all moved to this one are no longer used
  const accounts = await repo.listAccounts();
  for (const c of await repo.listConnections()) {
    if (c.id !== session.session_id && c.status === "active" && !accounts.some((a) => a.connectionId === c.id)) {
      await repo.setConnectionStatus(c.id, "revoked");
    }
  }
  await s.settings.bumpDataVersion();
  return { connectionId: session.session_id, accounts: session.accounts.length };
}

/**
 * A CSV account and a bank account with the same IBAN are one real account. The rows of the CSV account move
 * into the bank account, so the sync sees them as another source and skips what it already has instead of
 * counting every payment twice. Rows get the ids a later import into the bank account would give them.
 */
export async function foldCsvAccounts(repo: FinanceRepo): Promise<number> {
  const accounts = await repo.listAccounts();
  let folded = 0;
  for (const bank of accounts.filter((a) => a.provider === "enablebanking" && a.iban)) {
    const iban = normalizeIban(bank.iban);
    for (const csv of accounts.filter((a) => a.provider === "csv" && a.iban && a.id !== bank.id && normalizeIban(a.iban) === iban)) {
      const occurrence = new Map<string, number>();
      const newIds = new Map<string, string>();
      for (const t of await repo.transactionsOfAccount(csv.id)) {
        if (t.source !== "csv" || t.status !== "booked") continue;
        const base = `c|${t.bookingDate}|${t.amountCents}|${fold(t.counterparty ?? "")}|${fold(t.description ?? "")}`;
        const n = occurrence.get(base) ?? 0;
        occurrence.set(base, n + 1);
        newIds.set(t.id, await stableId(`${bank.id}|booked|${base}|${n}`));
      }
      await repo.mergeAccountInto(csv.id, bank.id, newIds);
      folded++;
    }
  }
  return folded;
}

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
export async function revokeAllConnections(s: Services, userId: string): Promise<{ revoked: number; failed: number }> {
  const repo = s.finance(userId);
  const active = (await repo.listConnections()).filter((c) => c.status === "active" && c.provider === "enablebanking");
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

// ── fetching ─────────────────────────────────────────────

export interface SyncSummary {
  status: "ok" | "partial" | "failed" | "skipped";
  fetched: number;
  inserted: number;
  messages: string[];
}

const LOCK_TTL_MS = 15 * 60_000;

/**
 * Fetches new transactions and balances for every account of the user's
 * active consents, then re-runs categorisation. PSD2 lets banks cap
 * unattended fetches at 4 a day per account, so schedule 1–4 runs a day.
 */
export async function syncUser(s: Services, userId: string, trigger: string): Promise<SyncSummary> {
  const lockKey = `sync_lock:${userId}`;
  if (!(await s.settings.tryLock(lockKey, LOCK_TTL_MS))) {
    return { status: "skipped", fetched: 0, inserted: 0, messages: ["Haku on jo käynnissä."] };
  }
  const repo = s.finance(userId);
  const today = s.today();
  const runId = await repo.startSyncRun(trigger);
  const summary: SyncSummary = { status: "ok", fetched: 0, inserted: 0, messages: [] };
  let failures = 0;
  let attempts = 0;

  try {
    const connections = (await repo.listConnections()).filter((c) => c.status === "active" && c.provider === "enablebanking");
    const client = connections.length ? await clientFor(s, userId) : null;
    const accounts = await repo.listAccounts();

    for (const conn of connections) {
      if (conn.validUntil && conn.validUntil.slice(0, 10) < today) {
        await repo.setConnectionStatus(conn.id, "expired");
        summary.messages.push(`${conn.institution}: yhteys vanheni ${finnishDate(conn.validUntil.slice(0, 10))}. Yhdistä uudelleen.`);
        failures++;
        continue;
      }
      for (const account of accounts.filter((a) => a.connectionId === conn.id && a.externalId)) {
        attempts++;
        try {
          const stored = await repo.latestBookingDate(account.id, "enablebanking");
          const latest = stored && stored > today ? today : stored;
          // re-read a 10 day overlap: late bookings, and pending rows that got booked
          const dateFrom = latest ? addDays(latest, -10) : addDays(today, -s.instance.current.historyDays);
          const raws = await client!.transactions(account.externalId!, dateFrom, latest ? "default" : "longest");
          const r = await ingestTransactions(repo, account.id, raws, "enablebanking", { replacePending: true });
          summary.fetched += r.fetched;
          summary.inserted += r.inserted;

          const balance = pickBalance(await client!.balances(account.externalId!));
          if (balance) await repo.setAccountBalance(account.id, amountToCents(balance.balance_amount.amount), s.now().toISOString());
          await repo.markAccountSynced(account.id, s.now().toISOString());
        } catch (err) {
          failures++;
          if (err instanceof EnableBankingError && err.appRejected) {
            // the app's key or id is wrong: the consents are fine, nothing to re-authorise
            summary.messages.push(`Enable Banking hylkäsi avaimen (${err.status}). Ylläpitäjä voi tarkistaa sen kohdassa Asetukset > Palvelin > Testaa yhteys.`);
            break;
          }
          if (err instanceof EnableBankingError && err.consentExpired) {
            await repo.setConnectionStatus(conn.id, "expired");
            summary.messages.push(`${conn.institution}: yhteys vanheni. Yhdistä uudelleen.`);
            break;
          }
          // the details go to the log; the bank's response text is not for the user's screen
          console.error(`sync ${account.id}:`, err);
          summary.messages.push(`${account.name}: ${err instanceof EnableBankingError ? `pankki vastasi virheellä ${err.status}` : "haku epäonnistui"}.`);
        }
      }
      await repo.markConnectionSynced(conn.id, s.now().toISOString());
    }

    await reprocess(repo, s.settings);
    // the hourly tick looks up right after its own fetches, for everyone at once
    if (summary.inserted && trigger !== "schedule") startLookup(s);
    summary.status = failures === 0 ? "ok" : failures < attempts ? "partial" : "failed";
  } catch (err) {
    summary.status = "failed";
    if (!(err instanceof UserError)) console.error(`sync ${userId}:`, err);
    summary.messages.push(err instanceof UserError ? err.message : "Haku epäonnistui. Pyydä ylläpitäjää tarkistamaan palvelimen loki.");
  } finally {
    await repo.finishSyncRun(runId, {
      status: summary.status === "skipped" ? "ok" : summary.status,
      fetched: summary.fetched,
      inserted: summary.inserted,
      message: summary.messages.join("\n") || null,
    });
    await s.settings.delete(lockKey);
  }
  return summary;
}

/** Scheduler entry point: every user with an active consent, one after another. */
export async function syncEveryone(s: Services, trigger: string): Promise<Record<string, SyncSummary>> {
  await s.instance.load();
  const results: Record<string, SyncSummary> = {};
  for (const userId of await s.users.usersWithActiveConnections()) results[userId] = await syncUser(s, userId, trigger);
  return results;
}
