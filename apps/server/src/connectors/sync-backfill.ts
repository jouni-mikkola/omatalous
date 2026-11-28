/** The backfill of an account's older days after a fetch (sync.ts). */
import { addDays } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import { accountKey } from "../db/household-repo.ts";
import type { StoredAccount } from "../db/rows.ts";
import { UpstreamError } from "../platform/errors.ts";
import type { Services } from "../services/context.ts";
import { ingestTransactions } from "../services/ingest.ts";
import { accountsAtLimit } from "./bank-limit.ts";
import { skippedNote, splitByCurrency } from "./foreign-split.ts";
import { countRows, keepRecord, type Tally } from "./sync-record.ts";
import type { SyncSummary } from "./sync.ts";
import type { Connector, PullAccount, Puller, RefusedRows } from "./types.ts";

/**
 * Backfill: a bank may give an account more history than its rows hold, for example when it refused the long first
 * window and the fetch fell back to a shorter one, or when Enable Banking's search for the longest history stopped short
 * (it answers what it found and never refuses). The fetches the member started, with the member's headers, ask once
 * more for the days before the oldest row, in windows of 12 months. The bank does not count such calls against its
 * daily limit. An account asked this way is left alone for a month, since a bank's limit rarely moves between consents;
 * the fetch right after a new consent asks anyway, because that is when a bank gives the most (Nordea gives 90 days
 * without one).
 *
 * A fetch the member started on the home network cannot give the headers (psu.ts sends no private address), so the bank
 * sees it as a background fetch and counts its windows against the four a day. Such a walk goes on only while the
 * account has room by the rule of an open without headers (bank-limit.ts), notes each window `backfill-bare`, and
 * resumes at the next fetch the member starts from the days already asked for, until the walk is over.
 */
export const BACKFILL_TRIGGERS = new Set(["manual", "connect"]);
/**
 * Without the headers only *Hae nyt* walks: the fetch right after a link has just spent the day's calls of the new
 * accounts, and the member's next press goes on from there.
 */
export const BARE_BACKFILL_TRIGGERS = new Set(["manual"]);
/** An account whose oldest row is this near the history limit needs no backfill. */
const BACKFILL_SLACK_DAYS = 31;
const BACKFILL_RETRY_DAYS = 30;
/** One request of a card is answered for 12 months at most. */
const BACKFILL_WINDOW_DAYS = 360;
/**
 * How far back the backfill looks, whatever the first fetch's history limit: that limit (730 days at most) is what one
 * request may ask for, and a bank such as S-Pankki may hold more than it. A window the bank refuses stops the walk, so
 * a bank with a shorter memory costs the calls up to its edge and the empty windows beyond it, once: the days asked for
 * are recorded, so the next walk starts where this one ended. An empty window never ends the walk, since a card unused
 * for a year still has older purchases.
 */
const BACKFILL_REACH_DAYS = 1825;
const BACKFILL_WINDOWS = 6;

/**
 * The rows of the days before the ones already asked for, as far back as the history limit; see BACKFILL_TRIGGERS.
 * `answered` is the window the fetch just made was answered for, `fresh` that it was the first fetch of a new consent,
 * `attended` that the member's headers went with the fetch. Never fails the fetch.
 */
export async function backfill(s: Services, repo: FinanceRepo, connector: Connector, puller: Puller, account: StoredAccount, target: PullAccount, answered: { dateFrom: string; longest: boolean }, fresh: boolean, attended: boolean, tally: Tally, summary: SyncSummary): Promise<void> {
  const wide = addDays(s.today(), -Math.max(s.instance.current.historyDays, BACKFILL_REACH_DAYS));
  const enough = addDays(wide, BACKFILL_SLACK_DAYS);
  const key = `backfill:${accountKey(account)}`;
  try {
    // an account with pending rows only has no booked row to start from: the days before today are all still to ask for
    const earliest = (await repo.earliestBookingDate(account.id, connector.id)) ?? s.today();
    // a first row near the limit leaves nothing to ask for
    if (earliest <= enough) return;
    // The days from the oldest row up to the first day ever asked for were asked for and found nothing. A plain window
    // says so truthfully. The longest history does not: its first day is where Enable Banking began to search, and a
    // record of it may be from before the record told a shortened ask.
    const recorded = (await s.household.historyOfKeys([accountKey(account)])).filter((h) => h.source === "default").map((h) => h.askedFrom);
    let to = [...(answered.longest ? [] : [answered.dateFrom]), earliest, ...recorded].reduce((a, b) => (b < a ? b : a));
    if (to <= enough) return;
    const last = await s.settings.get(key);
    if (!fresh && last && Date.parse(last) > s.now().getTime() - BACKFILL_RETRY_DAYS * 86_400_000) return;
    // Noted before the call: a refusal or a failure waits for the next period as well. A walk without the headers that
    // the day's room cut short is not over: it is noted when it ends, and the next fetch goes on from the days asked for.
    if (attended) await s.settings.set(key, s.now().toISOString());
    let paused = false;
    try {
      for (let i = 0; i < BACKFILL_WINDOWS && to > enough; i++) {
        if (!attended && (await accountsAtLimit(s, [accountKey(account)], "backfill-bare")).size) {
          paused = true;
          return;
        }
        const dateFrom = addDays(to, -BACKFILL_WINDOW_DAYS) < wide ? wide : addDays(to, -BACKFILL_WINDOW_DAYS);
        await keepRecord("fetch", () => repo.recordFetch(accountKey(account), s.now(), attended ? "backfill" : "backfill-bare"));
        const rows = await puller.transactions(target, { dateFrom, dateTo: to, initial: false });
        const split = splitByCurrency(rows, accountKey(account));
        const note = skippedNote(split.skipped, account.name);
        if (note && !summary.messages.includes(note)) summary.messages.push(note);
        const r = await ingestTransactions(repo, account.id, split.euro, connector.id, { keepPending: true });
        // the older days' twins and unreadable rows add to the account's count of the fetch (the days before it are not read
        // again by the next ordinary fetch, which then counts its own)
        const unread: RefusedRows = { ...puller.refused?.(target), ...(r.skipped ? { twin: r.skipped } : {}) };
        if (Object.keys(unread).length) {
          const held: RefusedRows = tally.refused[account.id] ?? {};
          tally.refused[account.id] = Object.fromEntries(
            (["status", "amount", "date", "twin"] as const).flatMap((k) => (held[k] || unread[k] ? [[k, (held[k] ?? 0) + (unread[k] ?? 0)]] : [])),
          ) as RefusedRows;
          tally.refusedChanged = true;
        }
        await countRows(repo, summary, tally, r);
        tally.rowsChanged += r.changed + (await repo.storeForeignRows(accountKey(account), split.foreign, s.now().toISOString()));
        // a refused window may have been answered from a later day, and the days before that one the bank will not give
        const from = puller.asked?.(target)?.dateFrom ?? dateFrom;
        await keepRecord("history", () => repo.recordHistory(account.id, from, "default", s.now().toISOString()));
        // an empty window says nothing of the ones before it; only a refusal does: the bank gives nothing before the day
        // it answered from
        if (from > dateFrom) return;
        to = dateFrom;
      }
    } finally {
      if (!attended && !paused) await s.settings.set(key, s.now().toISOString());
    }
  } catch (err) {
    // the bank's refusal of a long period is its answer, not a fault; anything else goes to the log
    if (!(err instanceof UpstreamError)) console.error(`backfill ${account.id}:`, err);
  }
}
