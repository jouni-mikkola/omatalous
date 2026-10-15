/**
 * Fetching new transactions and balances for a user from every connector that fetches, then re-running
 * categorisation. The loop is the same for every source: the lock, the run record, the overlap window, the
 * balance, reprocessing and the register lookup. A connector only answers what a pull returns (types.ts).
 */
import { addDays, type RawTransaction } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import { accountKey } from "../db/household-repo.ts";
import type { Connection, StoredAccount } from "../db/rows.ts";
import { UserError } from "../platform/errors.ts";
import { track } from "../platform/inflight.ts";
import type { Services } from "../services/context.ts";
import { connectionState } from "../services/accounts.ts";
import { reprocess } from "../services/enrich.ts";
import { startLookup } from "../services/industry.ts";
import { ingestTransactions } from "../services/ingest.ts";
import { balanceFitsAccount, balanceStamp, isEuro, storedBalanceCents } from "./balance-sign.ts";
import { markRateLimited } from "./bank-limit.ts";
import { type FetchProblem, type FetchProblems, readFetchProblems, writeFetchProblems } from "./fetch-problems.ts";
import { CONNECTORS } from "./registry.ts";
import type { BalanceReading, Connector, PullAccount, Puller } from "./types.ts";

/** "2026-09-30" → "30.9.2026" */
const finnishDate = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;

export interface SyncSummary {
  status: "ok" | "partial" | "failed" | "skipped";
  fetched: number;
  inserted: number;
  messages: string[];
}

export const LOCK_TTL_MS = 15 * 60_000;
/** Late bookings, and pending rows that got booked, show up in rows this far before the latest stored one. */
const OVERLAP_DAYS = 10;
/** The notes of calls to the bank (`account_fetch`) older than this are of no use for counting a day's fetches. */
const FETCH_NOTES_KEEP_DAYS = 8;

/**
 * The app counts in euros: another currency's amount would be added to them as if it were euros, so such rows are
 * left out. The note says how many a fetch left out and in which currencies.
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
  const note = skipped ? `${accountName}: ohitettu ${skipped === 1 ? "1 rivi, jonka" : `${skipped} riviä, joiden`} valuutta ei ole EUR (${[...foreign.keys()].join(", ")}).` : null;
  return { rows, note };
}

/** What one run adds up, across connectors. */
interface Tally {
  failures: number;
  attempts: number;
  /** Rows written, or a balance that moved: only then do categories and the cached analyses need work. */
  rowsChanged: number;
  balanceChanged: boolean;
  /** An account's name, holder, card number or limit was read again (the account list changed, no row did). */
  accountsChanged: boolean;
  /** Per account, what its fetch ran into (fetch-problems.ts); a fetch that works takes its entry away. */
  problems: FetchProblems;
  problemsChanged: boolean;
  /** A source answered that the app has fetched as often as it allows. */
  rateLimited: boolean;
}

/**
 * Fetches new transactions and balances for every account of the user's
 * active consents, then re-runs categorisation. PSD2 lets banks cap
 * unattended fetches at 4 a day per account, so schedule 1–4 runs a day.
 */
export function syncUser(s: Services, userId: string, trigger: string, userHeaders?: Readonly<Record<string, string>>): Promise<SyncSummary> {
  // a stop signal waits for a fetch in progress (entry/shutdown.ts)
  return track(fetchForUser(s, userId, trigger, userHeaders));
}

async function fetchForUser(s: Services, userId: string, trigger: string, userHeaders?: Readonly<Record<string, string>>): Promise<SyncSummary> {
  const lockKey = `sync_lock:${userId}`;
  if (!(await s.settings.tryLock(lockKey, LOCK_TTL_MS))) {
    return { status: "skipped", fetched: 0, inserted: 0, messages: ["Haku on jo käynnissä."] };
  }
  const repo = s.finance(userId);
  const runId = await repo.startSyncRun(trigger);
  const summary: SyncSummary = { status: "ok", fetched: 0, inserted: 0, messages: [] };
  const tally: Tally = { failures: 0, attempts: 0, rowsChanged: 0, balanceChanged: false, accountsChanged: false, problems: {}, problemsChanged: false, rateLimited: false };

  try {
    tally.problems = await readFetchProblems(s, userId);
    const active = (await repo.listConnections()).filter((c) => c.status === "active");
    for (const connector of CONNECTORS) {
      const connections = active.filter((c) => c.provider === connector.id);
      if (connector.sync && connections.length) await pullConnector(s, repo, connector, connections, summary, tally, trigger, userHeaders);
    }
    if (tally.rateLimited) await markRateLimited(s, userId);
    if (tally.problemsChanged) await writeFetchProblems(s, userId, tally.problems, (await repo.listAccounts()).map((a) => a.id));

    // a fetch that found nothing new leaves the history and everyone's cached analyses alone
    if (tally.rowsChanged) await reprocess(repo, s.settings);
    else if (tally.balanceChanged || tally.accountsChanged) await s.settings.bumpUserDataVersion(userId);
    // the hourly tick looks up right after its own fetches, for everyone at once
    if (summary.inserted && trigger !== "schedule") startLookup(s);
    summary.status = tally.failures === 0 ? "ok" : tally.failures < tally.attempts ? "partial" : "failed";
  } catch (err) {
    summary.status = "failed";
    if (!(err instanceof UserError)) console.error(`sync ${userId}:`, err);
    summary.messages.push(err instanceof UserError ? err.message : "Haku epäonnistui. Pyydä ylläpitäjää katsomaan palvelimen lokia.");
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

/**
 * Why a consent ended, in the words the connections table uses: past its date it "vanhentui" on that date; closed
 * earlier by the bank or Enable Banking it "katkesi", and its date, still ahead, is not shown.
 */
function endedMessage(conn: Connection, today: string): string {
  // the same date compare as the table, so the message and the Tila column never disagree
  const lapsed = connectionState({ status: "expired", validUntil: conn.validUntil }, today) === "lapsed";
  return lapsed
    ? `${conn.institution}: yhteys vanhentui ${finnishDate(conn.validUntil!.slice(0, 10))}. Yhdistä uudelleen.`
    : `${conn.institution}: yhteys katkesi. Yhdistä uudelleen.`;
}

function setProblem(tally: Tally, accountId: string, problem: FetchProblem | null): void {
  const old = tally.problems[accountId];
  if (!problem) {
    if (!old) return;
    delete tally.problems[accountId];
  } else {
    if (old?.kind === problem.kind && old.message === problem.message) return;
    tally.problems[accountId] = problem;
  }
  tally.problemsChanged = true;
}

/**
 * Every account of the connector's active connections, one after another. A failing account does not stop the
 * others; only a consent that ended stops the rest of its own accounts.
 */
async function pullConnector(s: Services, repo: FinanceRepo, connector: Connector, connections: Connection[], summary: SyncSummary, tally: Tally, trigger: string, userHeaders?: Readonly<Record<string, string>>): Promise<void> {
  const sync = connector.sync!;
  const today = s.today();
  await keepRecord("fetch notes", () => s.household.pruneFetchNotes(new Date(s.now().getTime() - FETCH_NOTES_KEEP_DAYS * 86_400_000).toISOString()));
  const puller = await sync.open({ s, repo, userHeaders });
  const accounts = await repo.listAccounts();
  const say = (message: string) => {
    // a key the source refuses fails every account with the same words: once is enough
    if (!summary.messages.includes(message)) summary.messages.push(message);
  };

  for (const conn of connections) {
    if (conn.validUntil && conn.validUntil.slice(0, 10) < today) {
      await repo.setConnectionStatus(conn.id, "expired");
      say(endedMessage(conn, today));
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
        // the call counts for the account's key from here on: a refusal or a failure after it is a call as well
        await keepRecord("fetch", () => repo.recordFetch(accountKey(account), s.now(), trigger.startsWith("open") ? "open" : trigger));
        const { rows: raws, note } = euroRows(await puller.transactions(target, { dateFrom, initial: latest === null }), account.name);
        if (note) summary.messages.push(note);
        const r = await ingestTransactions(repo, account.id, raws, connector.id);
        summary.fetched += r.fetched;
        summary.inserted += r.inserted;
        tally.rowsChanged += r.changed;
        await keepRecord("history", () => repo.recordHistory(account.id, dateFrom, "default", s.now().toISOString()));

        const told = await puller.balance(target);
        // The balance is the account's own money in the account's own currency, or it is not stored: a figure in
        // another currency would be read as euros, or as this account's.
        const shown = told[0];
        if (shown !== undefined && balanceFitsAccount(shown, account.currency)) {
          const cents = storedBalanceCents(account.type, shown.cents);
          const at = balanceStamp(shown, s.now(), today);
          // the walk starts from the day the balance stands for, so a new day with the same sum is a change as well
          if (account.balanceCents !== cents || (shown.referenceDay !== null && account.balanceAt !== at)) tally.balanceChanged = true;
          await repo.setAccountBalance(account.id, cents, at);
        }
        await keepRecord("balances", () => repo.recordBalances(accountKey(account), today, s.now().toISOString(), recordable(told, account)));
        await repo.markAccountSynced(account.id, s.now().toISOString());
        setProblem(tally, account.id, null);
        await readDetails(repo, puller, account, target, tally);
      } catch (err) {
        tally.failures++;
        const problem = sync.classify(err);
        if (problem?.kind === "app_rejected") {
          // the app's key or id is wrong: the consents are fine, nothing to re-authorise
          say(problem.message);
          continue;
        }
        if (problem?.kind === "consent_expired") {
          await repo.setConnectionStatus(conn.id, "expired");
          say(endedMessage(conn, today));
          break;
        }
        if (problem?.kind === "not_linked") {
          // a known state with its own fix, not a fault for the log
          setProblem(tally, account.id, { kind: "not_linked", message: problem.message });
          say(`${account.name}: ${problem.message}`);
          continue;
        }
        if (problem?.kind === "upstream" && problem.rateLimited) tally.rateLimited = true;
        // the details go to the log; the source's response text is not for the user's screen
        console.error(`sync ${account.id}:`, err);
        const message = `${problem ? problem.message : "haku epäonnistui"}.`;
        setProblem(tally, account.id, { kind: "failed", message });
        say(`${account.name}: ${message}`);
      }
    }
    await repo.markConnectionSynced(conn.id, s.now().toISOString());
  }
}

/** The balances of a fetch that may be recorded: named in euros and the account's own currency, signed as the account stores one. */
function recordable(told: readonly BalanceReading[], account: StoredAccount) {
  return told
    .filter((b) => isEuro(b.currency) && balanceFitsAccount(b, account.currency))
    .map((b) => ({ cents: storedBalanceCents(account.type, b.cents), type: b.type, referenceDay: b.referenceDay }));
}

/** What a fetch leaves behind to keep (the balances, the days asked for, the calls) is best effort: a failure to write it is logged and does not fail the fetch. */
async function keepRecord(what: string, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (err) {
    console.error(`recording ${what} failed:`, err);
  }
}

/**
 * An account linked before the bank's own name, holder, card number and limit were stored asks the bank once, after its
 * transactions. Best effort: a refusal, a rate limit or a failure leaves the account as it is (the holder stays unread)
 * and the next fetch asks again, and none of it counts against the fetch.
 */
async function readDetails(repo: FinanceRepo, puller: Puller, account: StoredAccount, target: PullAccount, tally: Tally): Promise<void> {
  if (!puller.details || account.holder !== null) return;
  try {
    const d = await puller.details(target);
    await repo.setAccountBankDetails(account.id, d);
    // a card is matched to its bills by the bank's name, so a new one means the transfers are worked out again
    if (account.type === "credit_card" && d.name !== null && d.name !== account.bankName) tally.rowsChanged++;
    else tally.accountsChanged = true;
  } catch {
    // retried at the next fetch
  }
}

/** Scheduler entry point: every user with an active consent, one after another. */
export async function syncEveryone(s: Services, trigger: string): Promise<Record<string, SyncSummary>> {
  await s.instance.load();
  const results: Record<string, SyncSummary> = {};
  for (const userId of await s.users.usersWithActiveConnections()) results[userId] = await syncUser(s, userId, trigger);
  return results;
}
