/**
 * Looks up merchants that no rule or card code recognised in the Finnish
 * trade register and keeps the answer (IndustryRepo). Starts right after an
 * import or a fetch that brought new rows, and again from the hourly
 * scheduler as a backstop. A few names at a time with a pause between, so the
 * public API is not hammered.
 *
 * Only the merchant's name leaves the server, and only a name whose rows
 * say it is a business (core industryCandidates): a card purchase, a direct
 * debit, an invoice to a payee that is no person as far as the name tells, a
 * company form or a business word in the name. A person's name never goes,
 * and neither does a name with a word of the household's own names (the
 * holders of its accounts, its members' display names): every string sent
 * passes askRegister. Admins can turn the lookup off (Asetukset > Palvelin).
 */
import {
  categoryByTradeWord,
  categoryForCompany,
  formQuery,
  householdWords,
  industryCandidates,
  type IndustryMatch,
  isLookupName,
  matchCompany,
  namesHousehold,
  shorterQuery,
} from "@banking/core";
import { RegistryError, type SearchResult, searchCompanies } from "../providers/prh/client.ts";
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
/** More hits than this for a plain name, none of them equal to it: the company is lost among namesakes, ask again with a company form. */
const MANY_HITS = 10;
/** Stop early when the register keeps failing; the names are retried next hour. */
const MAX_FAILURES = 3;

/**
 * The one door to the register: the name and its shorter form both go through here. A name core's isLookupName
 * refuses (a person's name, the name of a way to pay) makes no request and has no hits, and neither does a name
 * with a word of the household's own names (core namesHousehold). `household` is never left out: a caller that has no
 * names passes an empty set, and says so.
 */
export async function askRegister(fetchFn: typeof fetch, name: string, household: ReadonlySet<string>): Promise<SearchResult> {
  return isLookupName(name) && !namesHousehold(name, household) ? searchCompanies(fetchFn, name) : { companies: [], complete: true };
}

/**
 * One batch of names. With `deferred` the users whose rows now have a category are added to the set and not
 * processed here: a caller that runs several batches processes each user once at the end (drainLookups).
 */
export async function lookupIndustries(s: Services, opts: { limit?: number; pauseMs?: number; deferred?: Set<string> } = {}): Promise<LookupResult> {
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
    const members = [];
    for (const user of await s.users.list()) members.push({ user, accounts: await s.finance(user.id).listAccounts() });
    // the household's own names, the same for every member's rows: a partner's name is a payee on the other's account
    const household = householdWords(members.flatMap(({ user, accounts }) => [user.displayName, ...accounts.map((account) => account.holder)]));
    for (const { user, accounts } of members) {
      const names = industryCandidates(await s.finance(user.id).uncategorisedSpending(), accounts, household);
      perUser.set(user.id, names);
      fresh.set(user.id, await s.industry.recordRequests(user.id, names));
    }
    // names answered earlier (for another member) that now give someone a category
    const freshNames = [...new Set([...fresh.values()].flat())];
    const alreadyKnown = new Set<string>();
    for (const [merchant, answer] of await s.industry.codes(freshNames)) {
      if (categoryForCompany(answer)) alreadyKnown.add(merchant);
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
          let found = await askRegister(fetchFn, merchant, household);
          // a short name is found inside dozens of others: ask again with the company form, whose hits hold the company itself
          const withForm = found.companies.length > MANY_HITS && matchCompany(merchant, found.companies, { exactOnly: true }).status === "none" ? formQuery(merchant) : null;
          if (withForm) {
            if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
            const second = await askRegister(fetchFn, withForm, household);
            const ids = new Set(found.companies.map((c) => c.businessId));
            found = { companies: [...found.companies, ...second.companies.filter((c) => !ids.has(c.businessId))], complete: found.complete && second.complete };
          }
          // one page of a long hit list may miss the right company: then only an exact name counts
          match = matchCompany(merchant, found.companies, { exactOnly: !found.complete, byName: categoryByTradeWord });
          const shorter = match.status === "none" ? shorterQuery(merchant) : null;
          if (shorter) match = matchCompany(shorter, (await askRegister(fetchFn, shorter, household)).companies, { exactOnly: true, byName: categoryByTradeWord });
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
          if (opts.deferred) opts.deferred.add(userId);
          else result.recategorised += await reprocess(s.finance(userId), s.settings);
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
  // a fresh ten-year import takes many batches; the history is processed once per user at the end, not after each
  const deferred = new Set<string>();
  try {
    for (let i = 0; i < (opts.maxBatches ?? Infinity); i++) {
      const r = await lookupIndustries(s, { pauseMs: opts.pauseMs, deferred });
      total.looked += r.looked;
      total.categorised += r.categorised;
      if (r.skipped) {
        if (i === 0) total.skipped = r.skipped;
        break;
      }
      if (r.looked < BATCH) break;
    }
  } finally {
    // also when a batch threw: the answers it stored still apply
    for (const userId of deferred) total.recategorised += await reprocess(s.finance(userId), s.settings);
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
