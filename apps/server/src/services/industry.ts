/**
 * Looks up merchants that no rule or card code recognised in the Finnish
 * trade register and keeps the answer (IndustryRepo). Starts right after an
 * import or a fetch that brought new rows, and again from the hourly
 * scheduler as a backstop. A few names at a time with a pause between, so the
 * public API is not hammered.
 *
 * Only the merchant's name leaves the server, and only for names of
 * businesses (core industryCandidates): card purchases, direct debits and
 * payees with a company form in the name. Admins can turn it off
 * (Asetukset > Palvelin).
 */
import { categoryForIndustry, type IndustryCodeSet, industryCandidates, type IndustryMatch, matchCompany, shorterQuery } from "@banking/core";
import { RegistryError, searchCompanies } from "../providers/prh/client.ts";
import type { Services } from "./context.ts";
import { reprocess } from "./enrich.ts";

export interface LookupResult {
  /** Names sent to the register. */
  looked: number;
  /** Of those, how many got a category. */
  categorised: number;
  /** Transactions whose category changed afterwards. */
  recategorised: number;
  skipped?: "off" | "busy";
}

const LOCK = "industry_lock";
/** Names asked about in one run. */
const BATCH = 30;
/** Stop early when the register keeps failing; the names are retried next hour. */
const MAX_FAILURES = 3;

const isCodeSet = (v: string): v is IndustryCodeSet => v === "TOL2008" || v === "TOL2025";

export async function lookupIndustries(s: Services, opts: { limit?: number; pauseMs?: number } = {}): Promise<LookupResult> {
  const result: LookupResult = { looked: 0, categorised: 0, recategorised: 0 };
  const settings = await s.instance.load(true);
  if (!settings.industryLookup) return { ...result, skipped: "off" };
  if (!(await s.settings.tryLock(LOCK, 30 * 60_000))) return { ...result, skipped: "busy" };
  try {
    const limit = opts.limit ?? BATCH;
    const pauseMs = opts.pauseMs ?? 1000;
    const fetchFn = s.fetch ?? fetch;

    // A user sees an answer only for names their own lookup asked about. Record the
    // asking first: a name another member's lookup already answered then needs no new request.
    const perUser = new Map<string, string[]>();
    const fresh = new Map<string, string[]>();
    for (const user of await s.users.list()) {
      const repo = s.finance(user.id);
      const [rows, accounts] = await Promise.all([repo.uncategorisedSpending(), repo.listAccounts()]);
      const names = industryCandidates(rows, accounts);
      perUser.set(user.id, names);
      fresh.set(user.id, await s.industry.recordRequests(user.id, names));
    }
    // names answered earlier (for another member) that now give someone a category
    const freshNames = [...new Set([...fresh.values()].flat())];
    const alreadyKnown = new Set<string>();
    for (const [merchant, { code, codeSet }] of await s.industry.codes(freshNames)) {
      if (isCodeSet(codeSet) && categoryForIndustry(code, codeSet)) alreadyKnown.add(merchant);
    }

    // take turns between users so one big history does not use up every run
    const order = new Set<string>();
    const lists = [...perUser.values()];
    const longest = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) order.add(l[i]!);
    const due = (await s.industry.due([...order], s.now())).slice(0, limit);

    const categorised = new Set<string>();
    try {
      let failures = 0;
      for (const [i, merchant] of due.entries()) {
        if (i > 0 && pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
        let match: IndustryMatch;
        try {
          const first = await searchCompanies(fetchFn, merchant);
          // one page of a long hit list may miss the right company: then only an exact name counts
          match = matchCompany(merchant, first.companies, { exactOnly: !first.complete });
          const shorter = match.status === "none" ? shorterQuery(merchant) : null;
          if (shorter) match = matchCompany(shorter, (await searchCompanies(fetchFn, shorter)).companies, { exactOnly: true });
        } catch (err) {
          await s.industry.saveError(merchant, s.now());
          // the error's own text only: a merchant name is not written to the log
          const reason = err instanceof RegistryError ? err.message : `unexpected ${(err as Error)?.name ?? "error"}`;
          if (!(err instanceof RegistryError)) console.error(`industry lookup: ${reason}`);
          if (++failures >= MAX_FAILURES) {
            console.warn(`industry lookup paused: ${reason}`);
            break;
          }
          continue;
        }
        result.looked++;
        await s.industry.save(merchant, match, s.now());
        if (match.category) categorised.add(merchant);
      }
    } finally {
      // even when the run stopped early, apply the answers it got
      result.categorised = categorised.size;
      const askedFor = await s.industry.requestedBy([...categorised]);
      for (const userId of perUser.keys()) {
        if (askedFor.has(userId) || fresh.get(userId)!.some((n) => alreadyKnown.has(n))) {
          result.recategorised += await reprocess(s.finance(userId), s.settings);
        }
      }
    }
    return result;
  } finally {
    await s.settings.delete(LOCK);
  }
}

export function logLookup(r: LookupResult | null): void {
  if (r?.looked) console.log(`industry lookup: ${r.looked} merchants, ${r.categorised} categorised, ${r.recategorised} transactions updated`);
}

/**
 * Runs batches until a short one says nothing more is due (or the register
 * failed, or another run holds the lock). The cap keeps one caller from
 * running for ever; what is left is picked up by the next tick.
 */
export async function drainLookups(s: Services, opts: { maxBatches?: number; pauseMs?: number } = {}): Promise<LookupResult> {
  const total: LookupResult = { looked: 0, categorised: 0, recategorised: 0 };
  for (let i = 0; i < (opts.maxBatches ?? Infinity); i++) {
    const r = await lookupIndustries(s, { pauseMs: opts.pauseMs });
    total.looked += r.looked;
    total.categorised += r.categorised;
    total.recategorised += r.recategorised;
    if (r.skipped) {
      if (i === 0) total.skipped = r.skipped;
      break;
    }
    if (r.looked < BATCH) break;
  }
  return total;
}

/**
 * Looks up everything that is due without making the caller wait, so new rows
 * get their answers in minutes. A failure is only logged, and the log has no
 * merchant names.
 */
export function startLookup(s: Services): void {
  void drainLookups(s).then(logLookup).catch((err) => console.error("industry lookup failed:", err));
}
