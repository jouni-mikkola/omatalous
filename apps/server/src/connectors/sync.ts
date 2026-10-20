/**
 * Fetching new transactions and balances for a user from every connector that fetches, then re-running
 * categorisation. The loop is the same for every source: the lock, the run record, the overlap window, the
 * balance, reprocessing and the register lookup. A connector only answers what a pull returns (types.ts).
 */
import { addDays } from "@banking/core";
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
import { reconcileOf } from "../services/reconcile.ts";
import { balanceFitsAccount, balanceStamp, cardBalance, isEuro, storedBalanceCents } from "./balance-sign.ts";
import { accountsAtLimit, markRateLimited } from "./bank-limit.ts";
import { skippedNote, splitByCurrency } from "./foreign-split.ts";
import { type FetchProblem, type FetchProblems, readFetchProblems, writeFetchProblems } from "./fetch-problems.ts";
import { CONNECTORS } from "./registry.ts";
import { type RefusedByAccount, readRefusedRows, writeRefusedRows } from "./refused-rows.ts";
import type { BalanceReading, Connector, PullAccount, Puller, UserHeaders } from "./types.ts";

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

/** The triggers of a fetch the member started: one that cannot give the headers is noted `<trigger>-bare` (bank-limit.ts). */
const USER_STARTED = new Set(["manual", "connect", "open"]);

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
  /** Per account, the rows of its last fetch the source could not read (refused-rows.ts). */
  refused: RefusedByAccount;
  refusedChanged: boolean;
  /** A source answered that the app has fetched as often as it allows. */
  rateLimited: boolean;
}

/**
 * Fetches new transactions and balances for every account of the user's
 * active consents, then re-runs categorisation. PSD2 lets banks cap
 * unattended fetches at 4 a day per account, so schedule 1–4 runs a day;
 * an unattended run leaves out an account that has had its share (bank-limit.ts).
 */
export function syncUser(s: Services, userId: string, trigger: string, userHeaders?: UserHeaders): Promise<SyncSummary> {
  // a stop signal waits for a fetch in progress (entry/shutdown.ts)
  return track(fetchForUser(s, userId, trigger, userHeaders));
}

async function fetchForUser(s: Services, userId: string, trigger: string, userHeaders?: UserHeaders): Promise<SyncSummary> {
  const lockKey = `sync_lock:${userId}`;
  if (!(await s.settings.tryLock(lockKey, LOCK_TTL_MS))) {
    return { status: "skipped", fetched: 0, inserted: 0, messages: ["Haku on jo käynnissä."] };
  }
  const repo = s.finance(userId);
  const runId = await repo.startSyncRun(trigger);
  const summary: SyncSummary = { status: "ok", fetched: 0, inserted: 0, messages: [] };
  const tally: Tally = { failures: 0, attempts: 0, rowsChanged: 0, balanceChanged: false, accountsChanged: false, problems: {}, problemsChanged: false, refused: {}, refusedChanged: false, rateLimited: false };

  try {
    tally.problems = await readFetchProblems(s, userId);
    tally.refused = await readRefusedRows(s, userId);
    const active = (await repo.listConnections()).filter((c) => c.status === "active");
    for (const connector of CONNECTORS) {
      const connections = active.filter((c) => c.provider === connector.id);
      if (connector.sync && connections.length) await pullConnector(s, repo, connector, connections, summary, tally, trigger, userHeaders);
    }
    if (tally.rateLimited) await markRateLimited(s, userId);
    if (tally.problemsChanged || tally.refusedChanged) {
      const ids = (await repo.listAccounts()).map((a) => a.id);
      if (tally.problemsChanged) await writeFetchProblems(s, userId, tally.problems, ids);
      if (tally.refusedChanged) await writeRefusedRows(s, userId, tally.refused, ids);
    }

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
async function pullConnector(s: Services, repo: FinanceRepo, connector: Connector, connections: Connection[], summary: SyncSummary, tally: Tally, trigger: string, userHeaders?: UserHeaders): Promise<void> {
  const sync = connector.sync!;
  const today = s.today();
  await keepRecord("fetch notes", () => s.household.pruneFetchNotes(new Date(s.now().getTime() - FETCH_NOTES_KEEP_DAYS * 86_400_000).toISOString()));
  const puller = await sync.open({ s, repo, userHeaders });
  const accounts = await repo.listAccounts();
  // an unattended run skips the accounts that have had their fetches of the day, whoever made them; the member's other accounts go on
  // a fetch the user started that could not give the headers of an account's bank looks unattended to it: noted as such and counted
  const notedFor = new Map<string, string>();
  const byTrigger = new Map<string, string[]>();
  for (const a of accounts.filter((x) => x.externalId)) {
    const attended = !!userHeaders && (!puller.attended || (await puller.attended({ id: a.id, externalId: a.externalId!, name: a.name }).catch(() => false)));
    const noted = !attended && USER_STARTED.has(trigger) ? `${trigger}-bare` : trigger;
    notedFor.set(a.id, noted);
    byTrigger.set(noted, [...(byTrigger.get(noted) ?? []), accountKey(a)]);
  }
  const atLimit = new Set<string>();
  for (const [noted, keys] of byTrigger) for (const key of await accountsAtLimit(s, keys, noted)) atLimit.add(key);
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
    // A consent the user just gave is pulled for the first time by the fetch it set off: it asks the longest history once.
    // A background fetch never does, since a bank limits the calls a day; a consent it pulled first has had its chance.
    const fresh = trigger === "connect" && conn.lastSyncedAt === null;
    let skipped = 0;
    const own = accounts.filter((a) => a.connectionId === conn.id && a.externalId);
    for (const account of own) {
      if (atLimit.has(accountKey(account))) {
        skipped++;
        continue;
      }
      tally.attempts++;
      try {
        // An account whose rows are all in another currency (kept apart, not among the euro rows) or that has none yet
        // has no euro row, so the window follows its last completed fetch. Only an account never fetched before, or one on a consent
        // the user just gave (`fresh`), asks for the longest history.
        const stored = (await repo.latestBookingDate(account.id, connector.id)) ?? account.lastSyncedAt?.slice(0, 10) ?? null;
        const latest = stored && stored > today ? today : stored;
        const longest = latest === null || fresh;
        const dateFrom = longest ? addDays(today, -s.instance.current.historyDays) : addDays(latest!, -OVERLAP_DAYS);
        const target = { id: account.id, externalId: account.externalId!, name: account.name };
        // the call counts for the account's key from here on: a refusal or a failure after it is a call as well
        await keepRecord("fetch", () => repo.recordFetch(accountKey(account), s.now(), notedFor.get(account.id) ?? trigger));
        const split = splitByCurrency(await puller.transactions(target, { dateFrom, initial: longest }), accountKey(account));
        const note = skippedNote(split.skipped, account.name);
        if (note) summary.messages.push(note);
        const r = await ingestTransactions(repo, account.id, split.euro, connector.id);
        const refused = puller.refused?.(target) ?? {};
        if (JSON.stringify(refused) !== JSON.stringify(tally.refused[account.id] ?? {})) {
          tally.refused[account.id] = refused;
          tally.refusedChanged = true;
        }
        summary.fetched += r.fetched;
        summary.inserted += r.inserted;
        tally.rowsChanged += r.changed;
        // rows in another currency are kept in the bank's own figure; only a new or changed one moves the data version
        tally.rowsChanged += await repo.storeForeignRows(accountKey(account), split.foreign, s.now().toISOString());
        await keepRecord("history", () => repo.recordHistory(account.id, dateFrom, longest ? "longest" : "default", s.now().toISOString()));

        const told = await puller.balance(target);
        await keepRecord("balances", () => repo.recordBalances(accountKey(account), today, s.now().toISOString(), recordable(told, account)));
        // The balance is the account's own money in the account's own currency, or it is not stored: a figure in
        // another currency would be read as euros, or as this account's. A card's debt is read from a booked balance,
        // with the sign its reconciled balances taught (those just recorded included).
        const card = account.type === "credit_card";
        const shown = card ? cardBalance(told) : told[0];
        if (shown !== undefined && balanceFitsAccount(shown, account.currency)) {
          const cents = storedBalanceCents(account.type, shown.cents) * (card ? await cardSign(s, account) : 1);
          const at = balanceStamp(shown, s.now(), today);
          // the walk starts from the day the balance stands for, so a new day with the same sum is a change as well
          if (account.balanceCents !== cents || (shown.referenceDay !== null && account.balanceAt !== at)) tally.balanceChanged = true;
          await repo.setAccountBalance(account.id, cents, at);
        } else if (card && shown === undefined && told.length && account.balanceCents !== null) {
          // the card tells only available credit: a debt 0.64 read from it is wrong, and no balance is better
          await repo.setAccountBalance(account.id, null, null);
          tally.balanceChanged = true;
        }
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
    // a consent whose accounts were all left out has not been fetched: its first fetch is still to come
    if (skipped < own.length || !own.length) await repo.markConnectionSynced(conn.id, s.now().toISOString());
  }
}

/** The balances of a fetch that may be recorded: named in euros and the account's own currency, signed as the account stores one. */
function recordable(told: readonly BalanceReading[], account: StoredAccount) {
  return told
    .filter((b) => isEuro(b.currency) && balanceFitsAccount(b, account.currency))
    .map((b) => ({ cents: storedBalanceCents(account.type, b.cents), type: b.type, referenceDay: b.referenceDay }));
}

/** The sign a card's bank tells its debt with, learned by reconciling its stored balances; as told when that fails. */
async function cardSign(s: Services, account: StoredAccount): Promise<1 | -1> {
  try {
    return (await reconcileOf(s, account.userId, [account])).get(account.id)?.sign ?? 1;
  } catch (err) {
    console.error(`card sign ${account.id}:`, err);
    return 1;
  }
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
 * An account linked before the bank's own name, holder, card number, limit and type code were stored asks the bank once,
 * after its transactions. Best effort: a refusal, a rate limit or a failure leaves the account as it is (the holder or the
 * code stays unread) and the next fetch asks again, and none of it counts against the fetch.
 */
async function readDetails(repo: FinanceRepo, puller: Puller, account: StoredAccount, target: PullAccount, tally: Tally): Promise<void> {
  if (!puller.details || (account.holder !== null && account.bankTypeCode !== null)) return;
  try {
    const d = await puller.details(target);
    // a type stored before migration 0023 that the earlier rule would not have given was set by hand: it stays
    const byHand = account.typeSource === "user" || (account.typeSource === null && account.type !== d.earlierType);
    await repo.setAccountBankDetails(account.id, { ...d, typeSource: byHand ? "user" : "bank" });
    // a card is matched to its bills by the bank's name, and the type decides which payments are transfers, so either
    // change means the transfers are worked out again
    const typeMoved = !byHand && d.type !== null && d.type !== account.type;
    if (typeMoved || (account.type === "credit_card" && d.name !== null && d.name !== account.bankName)) tally.rowsChanged++;
    else tally.accountsChanged = true;
  } catch (err) {
    // retried at the next fetch; the log names the account and the kind of error, never the bank's answer
    console.error(`account details ${account.id}: ${err instanceof Error ? err.name : "error"}`);
  }
}

/** Scheduler entry point: every user with an active consent, one after another. */
export async function syncEveryone(s: Services, trigger: string): Promise<Record<string, SyncSummary>> {
  await s.instance.load();
  const results: Record<string, SyncSummary> = {};
  for (const userId of await s.users.usersWithActiveConnections()) results[userId] = await syncUser(s, userId, trigger);
  return results;
}
