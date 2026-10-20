/**
 * Whose money paid a joint account, kept and served. The trace itself is core's (`trace`, `settle`); this builds its
 * inputs from the household (the copies each member holds of the real account, the accounts one person uses alone, the
 * answers), keeps the parts every row was built with (`tx_part`) and the signature they were built from, and builds
 * them again under the account's lock when that signature differs: a new row, a restored copy, a said use, an answer.
 *
 * A pool is a real account with two users or more. Only a pool with a balance has a trace. The payers are this pool's
 * users: money from anybody else is unknown money, and an answer's owner must be one of them. A pool is traced after
 * the pools it receives from; where two pools pay each other no movement between them is carried, and each money-in
 * row is unknown money that is asked about once.
 */
import { createHash } from "node:crypto";
import {
  type Account,
  type AccountUse,
  type AccountUser,
  type Answer,
  balanceDayOf,
  type CardUse,
  dayNumber,
  holdersIn,
  isUserOwner,
  type Joined,
  joinCopies,
  nameOf,
  normalizeIban,
  OTHER_HOLDER,
  openOf,
  type Owner,
  type Part,
  type Payers,
  type Question,
  questionsOf,
  type RowShare,
  type SaidAnswer,
  samePerson,
  type SourcePart,
  settle,
  shareOf,
  splitOf,
  TRACE_VERSION,
  type Trace,
  type TraceRow,
  type TraceUser,
  trace,
  traceRows,
  type Transaction,
  userNameOf,
  type WhyCollector,
} from "@banking/core";
import { isEuro } from "../connectors/balance-sign.ts";
import type { StoredMember } from "../db/agreement-repo.ts";
import { type AnswerRow, accountKey, type PartRow } from "../db/household-repo.ts";
import type { StoredAccount } from "../db/rows.ts";
import { todayIn } from "../platform/config.ts";
import { UserError } from "../platform/errors.ts";
import { bumpSeers, isPool, usesInView } from "./account-use.ts";
import { pendingOf } from "./agreement-pending.ts";
import type { Services } from "./context.ts";
import { withUserLock } from "./enrich.ts";
import { offerOf, partRowsOf, windowOf } from "./money-trace-parts.ts";

/** Everything the trace of a pool reads about the household, loaded once. */
interface Household {
  accounts: StoredAccount[];
  byKey: Map<string, StoredAccount[]>;
  userIds: string[];
  /** The use of every real account, by key. */
  uses: Map<string, AccountUse>;
  /** The household members who have no login: a holder line that names one is that member (`m:<id>`). */
  members: StoredMember[];
  /** The days agreements stand from, by account key, and their kind (a `fixed` one is no card's): what the card rule of a bill reads. */
  agreements: { accountKey: string; validFrom: string; kind: string }[];
  /** The rows of every account, by account id; set by `withRows`. */
  rows: Map<string, Transaction[]>;
  /** Memos of one pass. */
  prepared: Map<string, Prepared | null>;
  raw: Map<string, Raw | null>;
  deps: Map<string, Set<string>>;
  /** The day and the time zone the household is read on. */
  today: string;
  timezone: string;
}

/** The rows of one pool and the payers it reads them with, before any movement between pools is carried. */
interface Prepared {
  account: StoredAccount;
  joined: Joined;
  payers: Omit<Payers, "legParts">;
}
interface Raw {
  prepared: Prepared;
  rows: TraceRow[];
  trace: Trace;
  /** The parts of every row of every copy, by row id. */
  partsById: Map<string, SourcePart[]>;
}

/** A pool's settled trace, in memory, with what a reader needs to cut it for a member. */
export interface SettledTrace {
  key: string;
  signature: string;
  /** The pool's users, in the order of the parts, and `split` "unknown" when their weights come from holder names and nobody said the split (ADR 0017). */
  users: TraceUser[];
  split?: "unknown";
  /** What the household said, as `settle` reads it. */
  answers: Answer[];
  /** The answers as `settlement` reads them: with the local day each was said on. */
  said: SaidAnswer[];
  /** The card accounts of the household and the owners who use this pool (`u:` the holder nobody names is not one). */
  cards: CardUse[];
  members: ReadonlySet<Owner>;
  /** The rows of the pool that the bank says paid a card bill (the category), by trace row key. */
  cardBills: ReadonlySet<string>;
  /** The trace before any answer, and after them. */
  raw: Trace;
  trace: Trace;
  /** Whether a part is one a question stands for (after the answers). */
  open: (p: SourcePart) => boolean;
  /** The questions that stand, largest first. */
  questions: Question[];
  /** The text a payer's row shows, by payer (`g:` key): the counterparty as the bank wrote it. */
  labels: Map<string, string>;
  /** The traced split of the account in whole percents when it differs from the weights and the app did not set it; null while not offered. */
  offer: { userId: string | null; percent: number }[] | null;
}

/** What a reader needs to know of an account before it counts it: whether it has a trace, and whether it is cut by it. */
export interface TraceFacts {
  key: string;
  /** What the parts were built from: part of a cache key. */
  signature: string;
  /** The account is a pool with a trace stored. */
  hasTrace: boolean;
  /** The account is cut by its rows' parts: it has a trace and a split row. */
  traced: boolean;
  split?: { by: "app" | "user"; at: string };
}

/**
 * The owner a user of an account is in a trace: `u:<id>`. The holders who have no login are the household member their
 * line of holders names, matched as the bank writes the name (`m:<id>`), else nobody in particular (`u:`).
 */
function ownerOf(h: Household, u: AccountUser): Owner {
  if (u.userId !== null) return `u:${u.userId}`;
  const holders = u.label !== OTHER_HOLDER ? holdersIn(u.label) : [];
  const hits = holders.length === 1 ? h.members.filter((m) => samePerson(nameOf(m.name), holders[0]!.name)) : [];
  return hits.length === 1 ? `m:${hits[0]!.id}` : "u:";
}
const weighted = (use: AccountUse) => use.users.filter((u) => u.weight > 0);
const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);

/** Of an account's copies the one whose line of holders names the most, as `usesInView` reads the line: its label of the holders who are no user is whole. */
function fullest(copies: readonly StoredAccount[]): StoredAccount {
  const count = (a: StoredAccount) => holdersIn(a.holder).length;
  return copies.reduce((best, a) => (count(a) > count(best) || (count(a) === count(best) && (a.holder ?? "") < (best.holder ?? "")) ? a : best));
}

async function loadHousehold(s: Services): Promise<Household> {
  const [accounts, users, members, agreements] = await Promise.all([s.household.allAccounts(), s.users.list(), s.agreements.members(), s.agreements.allAgreements()]);
  const byKey = new Map<string, StoredAccount[]>();
  for (const a of accounts) byKey.set(accountKey(a), [...(byKey.get(accountKey(a)) ?? []), a]);
  const uses = new Map<string, AccountUse>();
  const first = users[0];
  if (first && byKey.size) {
    const standing = [...byKey.values()].map(fullest);
    const read = await usesInView(s, first.id, standing);
    for (const a of standing) uses.set(accountKey(a), read.get(a.id)!.use);
  }
  return { accounts, byKey, userIds: users.map((u) => u.id), uses, members,
    agreements: agreements.filter((r) => !pendingOf(r)).map(({ accountKey: key, validFrom, kind }) => ({ accountKey: key, validFrom, kind })), rows: new Map(), prepared: new Map(), raw: new Map(), deps: new Map(), today: s.today(), timezone: s.instance.current.timezone };
}

async function withRows(s: Services, h: Household): Promise<void> {
  if (h.rows.size) return;
  const all = await s.household.transactionsOfAccounts(h.accounts.map((a) => a.id));
  for (const a of h.accounts) h.rows.set(a.id, []);
  for (const t of all) h.rows.get(t.accountId)!.push(t);
}

const keyOfAccount = (h: Household, accountId: string): string => {
  const a = h.accounts.find((x) => x.id === accountId);
  return a ? accountKey(a) : accountId;
};

/** A card account: a credit card with no IBAN to key it by (the type the pairing of a bill with the card's row reads). */
export const isCardAccount = (a: StoredAccount): boolean => !normalizeIban(a.iban) && a.type === "credit_card";

/**
 * The payers of a pool: this pool's users only (`u:<id>`, and `u:` for the holders who are no user), by IBAN and by name.
 * A card account is keyed by the account, and `cardHolderOf` says whose a bill paid to it is: the bill of a card one member
 * uses is that member's; a card of two users is nobody's alone, so its bill stays a cost of the pool, cut once by the pool's
 * weights; a card of a holder with no login stays so too.
 */
function payersOf(h: Household, key: string): Omit<Payers, "legParts" | "others"> {
  const use = h.uses.get(key)!;
  const mine = new Set(weighted(use).map((u) => ownerOf(h, u)));
  const alone = new Map<string, Owner>();
  const byAccount = new Map<string, CardUse>();
  const pools = new Set<string>();
  for (const [k, other] of h.uses) {
    const users = weighted(other);
    const sole = users.length === 1 ? ownerOf(h, users[0]!) : null;
    const only = sole !== "u:" ? sole : null;
    for (const a of h.byKey.get(k) ?? []) {
      const iban = normalizeIban(a.iban);
      if (!iban) {
        if (isCardAccount(a)) byAccount.set(a.id, { key: k, users: users.map((u) => ({ owner: ownerOf(h, u), weight: u.weight })) });
        continue;
      }
      if (users.length >= 2) pools.add(iban);
      else if (only !== null && mine.has(only)) alone.set(iban, only);
    }
  }
  const names = weighted(use).flatMap((u) => {
    if (u.userId === null) {
      const holders = holdersIn(u.label);
      return u.label !== OTHER_HOLDER && holders.length === 1 ? [{ owner: ownerOf(h, u), name: holders[0]!.name }] : [];
    }
    const name = userNameOf(h.accounts.filter((a) => a.userId === u.userId));
    return name ? [{ owner: ownerOf(h, u), name }] : [];
  });
  return { accounts: h.accounts as Account[], alone, cards: { byAccount, members: mine, agreements: h.agreements }, pools, names };
}

/** The joined rows of a pool and its payers; null when it has no rows, no balance, or no booked row. */
function prepare(h: Household, key: string): Prepared | null {
  if (h.prepared.has(key)) return h.prepared.get(key)!;
  const copies = (h.byKey.get(key) ?? []).map((a) => ({ accountId: a.id, rows: h.rows.get(a.id) ?? [] })).filter((c) => c.rows.length);
  let result: Prepared | null = null;
  if (copies.length) {
    const joined = joinCopies(copies);
    const account = h.accounts.find((a) => a.id === joined.accountId)!;
    const mine = new Set((h.byKey.get(key) ?? []).map((a) => a.id));
    const others = h.accounts.filter((a) => !mine.has(a.id)).flatMap((a) => (h.rows.get(a.id) ?? []).filter((t) => t.status !== "pending"));
    // a balance in another currency is no figure to trace euro rows from
    if (account.balanceCents !== null && isEuro(account.currency) && joined.rows.some((r) => !r.unmatched && r.tx.status !== "pending")) result = { account, joined, payers: { ...payersOf(h, key), others } };
  }
  h.prepared.set(key, result);
  return result;
}

/** The pools a pool receives from, found by reading its rows with no movement carried. */
function depsOf(h: Household, key: string): Set<string> {
  const known = h.deps.get(key);
  if (known) return known;
  const found = new Set<string>();
  h.deps.set(key, found);
  const p = prepare(h, key);
  if (p) {
    traceRows(p.joined, {
      ...p.payers,
      legParts: (leg) => {
        found.add(keyOfAccount(h, leg.accountId));
        return undefined;
      },
    });
  }
  return found;
}

function reaches(h: Household, from: string, to: string, seen = new Set<string>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return [...depsOf(h, from)].some((next) => reaches(h, next, to, seen));
}

/** The core trace of one pool; null when it refuses the rows, so that one pool is served as not traced and the others are not touched. The line names no account and no sum. */
function traceOrNull(...args: Parameters<typeof trace>): Trace | null {
  try {
    return trace(...args);
  } catch (err) {
    console.error(`the money trace of a pool failed (${(err as Error).message}); it is served as not traced`);
    return null;
  }
}

/** A pool's trace before any answer. Pools it receives from are traced first and their parts are carried; pools that pay each other are not. */
function rawOf(h: Household, key: string): Raw | null {
  if (h.raw.has(key)) return h.raw.get(key)!;
  h.raw.set(key, null);
  const p = prepare(h, key);
  if (!p) return null;
  const several = [...h.uses.values()].filter(isPool).length > 1;
  const users = new Set(weighted(h.uses.get(key)!).map((u) => ownerOf(h, u)));
  const rows = traceRows(p.joined, {
    ...p.payers,
    ...(several
      ? {
          // a carried part whose owner uses no part of this pool is unknown money of the sending pool ("c" is what core relabels so), so that a question stands for it
          legParts: (leg: Transaction) => {
            const other = keyOfAccount(h, leg.accountId);
            const parts = other === key || reaches(h, other, key) ? undefined : rawOf(h, other)?.partsById.get(leg.id);
            return parts?.map((part) => (isUserOwner(part.owner) && !users.has(part.owner) ? { ...part, owner: "c" } : part));
          },
        }
      : {}),
  });
  // the opening is what the traced copy held before the joined rows: its balance less the booked rows that are not unmatched, up to the day the balance stands for
  const booked = p.joined.rows.filter((r) => !r.unmatched && r.tx.status !== "pending");
  const balanceDay = dayNumber(balanceDayOf(localDay(h, p.account.balanceAt), h.today));
  const opening = p.account.balanceCents! - booked.filter((r) => dayNumber(r.tx.bookingDate) <= balanceDay).reduce((sum, r) => sum + r.tx.amountCents, 0);
  const t = traceOrNull(rows, opening, Math.min(...booked.map((r) => dayNumber(r.tx.bookingDate))));
  if (!t) return null;
  const partsById = new Map<string, SourcePart[]>();
  for (const r of t.rows) for (const id of r.ids) partsById.set(id, r.parts);
  const raw: Raw = { prepared: p, rows, trace: t, partsById };
  h.raw.set(key, raw);
  return raw;
}

/** The local day a balance was given: the books count local days, as the balances of a request do. */
const localDay = (h: Household, at: string | null): string | null => {
  const when = at ? new Date(at) : null;
  return when && !Number.isNaN(when.getTime()) ? todayIn(h.timezone, when) : null;
};

const answersOf = (rows: readonly AnswerRow[]): Answer[] => rows.map((r) => ({ kind: r.kind, key: r.kind === "opening" ? "o" : r.answerKey, owner: r.owner }));

function settledOf(h: Household, key: string, signature: string, answerRows: readonly AnswerRow[], split: boolean): SettledTrace | null {
  const raw = rawOf(h, key);
  if (!raw) return null;
  const users = weighted(h.uses.get(key)!).map((u): TraceUser => ({ owner: ownerOf(h, u), weight: u.weight }));
  // an answer names its owner: one who is no user now (the users changed) is no answer, and the question stands again
  const kept = answerRows.filter((a) => a.owner === "all" || a.owner === "none" || users.some((u) => u.owner === a.owner));
  const answers = answersOf(kept);
  const said = answers.map((a, i): SaidAnswer => ({ ...a, saidOn: localDay(h, kept[i]!.saidAt) ?? kept[i]!.saidAt.slice(0, 10) }));
  const cardUses = new Map([...(raw.prepared.payers.cards?.byAccount.values() ?? [])].map((c) => [c.key, c]));
  const settled = settle(raw.trace, answers, users);
  const window = windowOf(h.today);
  const labels = new Map<string, string>();
  const cardBills = new Set<string>();
  const txOf = new Map(raw.prepared.joined.rows.map((x) => [x.key, x.tx]));
  for (const r of raw.rows) {
    const tx = txOf.get(r.key);
    if (tx?.category === "card_bill") cardBills.add(r.key);
    if (r.group && tx && !labels.has(r.group)) labels.set(r.group, tx.counterparty?.trim() || tx.counterpartyIban || tx.description?.trim() || r.group);
  }
  return {
    key, signature, users, ...(h.uses.get(key)!.split ? { split: "unknown" as const } : {}),
    answers,
    said,
    cards: [...cardUses.values()],
    members: new Set([...(raw.prepared.payers.cards?.members ?? [])].filter((o) => o !== "u:")),
    cardBills,
    raw: raw.trace,
    trace: settled,
    open: openOf(raw.trace, answers),
    questions: questionsOf(raw.trace, answers),
    labels,
    offer: split ? null : offerOf(raw.trace, users, window, splitOf(raw.trace, answers, users, window)),
  };
}

async function signatureOf(s: Services, h: Household, key: string, today: string): Promise<{ signature: string; split: TraceFacts["split"]; answers: AnswerRow[] }> {
  const [version, splits, answers] = await Promise.all([s.settings.dataVersionOf(h.userIds), s.household.splitRows([key]), s.household.answerRows(key)]);
  const use = h.uses.get(key)!;
  const split = splits[0];
  const cardKeys = new Set([...h.byKey].filter(([, copies]) => copies.some(isCardAccount)).map(([k]) => k));
  // what names the owners (the members) and what says whose a card bill is (the cards' agreements) are read by the rows' parts
  const signature = sha([
    TRACE_VERSION,
    version,
    windowOf(today).from,
    use.source,
    use.users.map((u) => [u.userId, u.weight]),
    split ? [split.setBy, split.setAt] : null,
    answers.map((a) => [a.kind, a.answerKey, a.owner, a.saidAt]),
    h.members.map((m) => [m.id, m.name]),
    h.agreements.filter((a) => cardKeys.has(a.accountKey)).map((a) => [a.accountKey, a.validFrom, a.kind]),
  ]);
  return { signature, split: split ? { by: split.setBy === null ? "app" : "user", at: split.setAt } : undefined, answers };
}

/** In-process memo of the last settled trace of each pool, by the signature it was built for. */
const memo = new WeakMap<Services, Map<string, SettledTrace>>();
const memoOf = (s: Services): Map<string, SettledTrace> => {
  let m = memo.get(s);
  if (!m) memo.set(s, (m = new Map()));
  return m;
};

/** Builds the parts of a pool again, under its lock: reads the household afresh, sets the split when the app may, and writes what changed. */
async function rebuild(s: Services, key: string): Promise<void> {
  const h = await loadHousehold(s);
  const today = h.today;
  const use = h.uses.get(key);
  const ids = (h.byKey.get(key) ?? []).map((a) => a.id);
  if (!isPool(use)) {
    const state = await s.household.partsState(key);
    if (state) await s.household.clearParts(key, [...(await s.household.partsOf(ids)).keys()]);
    memoOf(s).delete(key);
    return;
  }
  const { signature, split, answers } = await signatureOf(s, h, key, today);
  // a build that waited for the lock finds the work done
  if ((await s.household.partsState(key))?.signature === signature) return;
  await withRows(s, h);
  let settled = settledOf(h, key, signature, answers, !!split);
  const at = s.now().toISOString();
  if (settled && !split && use.source !== "said") {
    // set by the app, once: nobody said a use, the bank names two holders or more, the history reaches the window, no cost row in it has an unknown part, no part got its owner from an answer
    const window = windowOf(today);
    const c = splitOf(settled.raw, settled.answers, settled.users, window);
    if (use.source === "bank" && c.c3 && c.c4 && c.c5 && (await s.household.setSplit(key, null, at, false))) {
      await bumpSeers(s, key);
      settled = { ...settled, offer: null };
    }
  }
  const had = await s.household.partsOf(ids);
  await s.household.writeParts(settled ? partRowsOf(settled) : new Map(), had, {
    key,
    signature,
    builtAt: at,
    lots: JSON.stringify(settled ? { lots: settled.trace.lots, before: settled.trace.before, creditCents: settled.trace.creditCents, openingCents: settled.trace.openingCents } : null),
  });
  if (settled) memoOf(s).set(key, settled);
  else memoOf(s).delete(key);
}

/**
 * Makes sure of the trace of one real account: when what its parts were built from differs from what the household
 * holds now, they are built again. Null for an account that is no pool. A read of the parts after this sees a whole
 * build or the one before, never half of one.
 */
export async function ensureTrace(s: Services, key: string): Promise<TraceFacts | null> {
  const h = await loadHousehold(s);
  if (!isPool(h.uses.get(key))) {
    if (await s.household.partsState(key)) await withUserLock(`trace:${key}`, () => rebuild(s, key));
    return null;
  }
  let state = await s.household.partsState(key);
  // a second round only when the first changed what it was built from (the app set the split)
  for (let round = 0; round < 2; round++) {
    const now = await signatureOf(s, round === 0 ? h : await loadHousehold(s), key, h.today);
    if (state?.signature === now.signature) break;
    await withUserLock(`trace:${key}`, () => rebuild(s, key));
    state = await s.household.partsState(key);
  }
  const split = (await s.household.splitRows([key]))[0];
  const hasTrace = state !== null && state.lots !== "null";
  return {
    key,
    signature: state?.signature ?? "",
    hasTrace,
    traced: hasTrace && !!split,
    ...(split ? { split: { by: split.setBy === null ? ("app" as const) : ("user" as const), at: split.setAt } } : {}),
  };
}

/** The users of real accounts as a trace names them (the members who have no login as `m:<id>`), by key; a key that is no account of the household has none. */
export async function poolUsers(s: Services, keys: readonly string[]): Promise<Map<string, TraceUser[]>> {
  const h = await loadHousehold(s);
  return new Map(keys.map((key) => [key, h.uses.has(key) ? weighted(h.uses.get(key)!).map((u): TraceUser => ({ owner: ownerOf(h, u), weight: u.weight })) : []]));
}

/** The settled trace of one real account in memory; null when it has none (no pool, no balance, no booked row). */
export async function settledTrace(s: Services, key: string): Promise<SettledTrace | null> {
  const facts = await ensureTrace(s, key);
  if (!facts?.hasTrace) return null;
  const kept = memoOf(s).get(key);
  if (kept && kept.signature === facts.signature) return kept;
  const h = await loadHousehold(s);
  await withRows(s, h);
  const settled = settledOf(h, key, facts.signature, await s.household.answerRows(key), !!facts.split);
  if (settled) memoOf(s).set(key, settled);
  return settled;
}

/** One member's cents of every row of a settled trace, by the id of the row on each copy; `why` collects whose money each part was, for "Miksi?". */
export function sharesOf(t: SettledTrace, viewerId: string, part: Part, why?: WhyCollector): Map<string, RowShare> {
  const shares = new Map<string, RowShare>();
  for (const row of t.trace.rows) {
    // a row with no parts is cut by the part, as a row with no stored parts is in SQL
    if (!row.parts.length) continue;
    const share = shareOf(row, `u:${viewerId}`, part, t.open, why);
    for (const id of row.ids) shares.set(id, share);
  }
  return shares;
}

/**
 * Says whose money a payer's or the opening's was. Refuses a key no question stands for and an owner who is not a user
 * of the account (or "all" or "none"). Who may say it is the caller's to check.
 */
export async function sayAnswer(s: Services, key: string, answer: Answer, saidBy: string): Promise<void> {
  const t = await settledTrace(s, key);
  if (!t || !questionsOf(t.raw, []).some((q) => q.kind === answer.kind && q.key === answer.key)) throw new UserError("Kysymystä ei löydy.");
  if (answer.owner !== "all" && answer.owner !== "none" && !t.users.some((u) => u.owner === answer.owner)) throw new UserError("Valitse yksi tilin käyttäjistä.");
  await s.household.setAnswer(key, answer.kind, answer.kind === "opening" ? "" : answer.key, answer.owner, saidBy, s.now().toISOString());
  await bumpSeers(s, key);
}

/** Takes back an answer; the question stands again. */
export async function takeBackAnswer(s: Services, key: string, kind: Answer["kind"], answerKey: string): Promise<void> {
  await s.household.deleteAnswer(key, kind, kind === "opening" ? "" : answerKey);
  await bumpSeers(s, key);
}
