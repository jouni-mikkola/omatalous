/**
 * Fetching new transactions and balances for a user from every connector that fetches, then re-running
 * categorisation. The loop is the same for every source: the lock, the run record, the overlap window, the
 * balance, reprocessing and the register lookup. A connector only answers what a pull returns (types.ts).
 */
import { addDays, type RawTransaction } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import type { Connection } from "../db/rows.ts";
import { UserError } from "../platform/errors.ts";
import { track } from "../platform/inflight.ts";
import type { Services } from "../services/context.ts";
import { reprocess } from "../services/enrich.ts";
import { startLookup } from "../services/industry.ts";
import { ingestTransactions } from "../services/ingest.ts";
import { CONNECTORS } from "./registry.ts";
import type { Connector } from "./types.ts";

/** "2026-09-30" → "30.9.2026" */
const finnishDate = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;

export interface SyncSummary {
  status: "ok" | "partial" | "failed" | "skipped";
  fetched: number;
  inserted: number;
  messages: string[];
}

const LOCK_TTL_MS = 15 * 60_000;
/** Late bookings, and pending rows that got booked, show up in rows this far before the latest stored one. */
const OVERLAP_DAYS = 10;

/**
 * The app counts in euros: another currency's amount would be added to them as if it were euros. The CSV parser
 * leaves such rows out too. The note says how many a fetch left out, in the words of the import's message.
 */
function euroRows(raws: readonly RawTransaction[], accountName: string): { rows: RawTransaction[]; note: string | null } {
  const foreign = new Map<string, number>();
  const rows = raws.filter((r) => {
    const currency = (r.currency || "EUR").toUpperCase();
    if (currency === "EUR") return true;
    foreign.set(currency, (foreign.get(currency) ?? 0) + 1);
    return false;
  });
  const skipped = [...foreign.values()].reduce((a, b) => a + b, 0);
  const note = skipped ? `${accountName}: ohitettu ${skipped === 1 ? "1 rivi" : `${skipped} riviä`}, joiden valuutta ei ole EUR (${[...foreign.keys()].join(", ")}).` : null;
  return { rows, note };
}

/** What one run adds up, across connectors. */
interface Tally {
  failures: number;
  attempts: number;
  /** Rows written, or a balance that moved: only then do categories and the cached analyses need work. */
  rowsChanged: number;
  balanceChanged: boolean;
}

/**
 * Fetches new transactions and balances for every account of the user's
 * active consents, then re-runs categorisation. PSD2 lets banks cap
 * unattended fetches at 4 a day per account, so schedule 1–4 runs a day.
 */
export function syncUser(s: Services, userId: string, trigger: string): Promise<SyncSummary> {
  // a stop signal waits for a fetch in progress (entry/shutdown.ts)
  return track(fetchForUser(s, userId, trigger));
}

async function fetchForUser(s: Services, userId: string, trigger: string): Promise<SyncSummary> {
  const lockKey = `sync_lock:${userId}`;
  if (!(await s.settings.tryLock(lockKey, LOCK_TTL_MS))) {
    return { status: "skipped", fetched: 0, inserted: 0, messages: ["Haku on jo käynnissä."] };
  }
  const repo = s.finance(userId);
  const runId = await repo.startSyncRun(trigger);
  const summary: SyncSummary = { status: "ok", fetched: 0, inserted: 0, messages: [] };
  const tally: Tally = { failures: 0, attempts: 0, rowsChanged: 0, balanceChanged: false };

  try {
    const active = (await repo.listConnections()).filter((c) => c.status === "active");
    for (const connector of CONNECTORS) {
      const connections = active.filter((c) => c.provider === connector.id);
      if (connector.sync && connections.length) await pullConnector(s, repo, connector, connections, summary, tally);
    }

    // a fetch that found nothing new leaves the history and everyone's cached analyses alone
    if (tally.rowsChanged) await reprocess(repo, s.settings);
    else if (tally.balanceChanged) await s.settings.bumpUserDataVersion(userId);
    // the hourly tick looks up right after its own fetches, for everyone at once
    if (summary.inserted && trigger !== "schedule") startLookup(s);
    summary.status = tally.failures === 0 ? "ok" : tally.failures < tally.attempts ? "partial" : "failed";
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

/** Every account of the connector's active connections, one after another. A failure ends only its connection. */
async function pullConnector(s: Services, repo: FinanceRepo, connector: Connector, connections: Connection[], summary: SyncSummary, tally: Tally): Promise<void> {
  const sync = connector.sync!;
  const today = s.today();
  const puller = await sync.open({ s, repo });
  const accounts = await repo.listAccounts();

  for (const conn of connections) {
    if (conn.validUntil && conn.validUntil.slice(0, 10) < today) {
      await repo.setConnectionStatus(conn.id, "expired");
      summary.messages.push(`${conn.institution}: yhteys vanheni ${finnishDate(conn.validUntil.slice(0, 10))}. Yhdistä uudelleen.`);
      tally.failures++;
      continue;
    }
    for (const account of accounts.filter((a) => a.connectionId === conn.id && a.externalId)) {
      tally.attempts++;
      try {
        // An account whose rows were all left out (another currency) or that has none yet stores nothing, so the
        // window follows its last completed fetch. Only an account never fetched before asks for the longest history.
        const stored = (await repo.latestBookingDate(account.id, connector.id)) ?? account.lastSyncedAt?.slice(0, 10) ?? null;
        const latest = stored && stored > today ? today : stored;
        const dateFrom = latest ? addDays(latest, -OVERLAP_DAYS) : addDays(today, -s.instance.current.historyDays);
        const target = { id: account.id, externalId: account.externalId!, name: account.name };
        const { rows: raws, note } = euroRows(await puller.transactions(target, { dateFrom, initial: latest === null }), account.name);
        if (note) summary.messages.push(note);
        const r = await ingestTransactions(repo, account.id, raws, connector.id, { replacePending: sync.replacePending });
        summary.fetched += r.fetched;
        summary.inserted += r.inserted;
        tally.rowsChanged += r.changed;

        const cents = await puller.balance(target);
        if (cents !== null) {
          if (account.balanceCents !== cents) tally.balanceChanged = true;
          await repo.setAccountBalance(account.id, cents, s.now().toISOString());
        }
        await repo.markAccountSynced(account.id, s.now().toISOString());
      } catch (err) {
        tally.failures++;
        const problem = sync.classify(err);
        if (problem?.kind === "app_rejected") {
          // the app's key or id is wrong: the consents are fine, nothing to re-authorise
          summary.messages.push(problem.message);
          break;
        }
        if (problem?.kind === "consent_expired") {
          await repo.setConnectionStatus(conn.id, "expired");
          summary.messages.push(`${conn.institution}: yhteys vanheni. Yhdistä uudelleen.`);
          break;
        }
        // the details go to the log; the source's response text is not for the user's screen
        console.error(`sync ${account.id}:`, err);
        summary.messages.push(`${account.name}: ${problem ? problem.message : "haku epäonnistui"}.`);
      }
    }
    await repo.markConnectionSynced(conn.id, s.now().toISOString());
  }
}

/** Scheduler entry point: every user with an active consent, one after another. */
export async function syncEveryone(s: Services, trigger: string): Promise<Record<string, SyncSummary>> {
  await s.instance.load();
  const results: Record<string, SyncSummary> = {};
  for (const userId of await s.users.usersWithActiveConnections()) results[userId] = await syncUser(s, userId, trigger);
  return results;
}
