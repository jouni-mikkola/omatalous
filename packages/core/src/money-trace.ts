/**
 * Whose money paid every row of a joint account (a pool). The pool holds lots: money with an owner, a kind and a tier.
 * Money in makes lots, money out takes them, and every row keeps the parts it took, so a shared cost can be told apart
 * from one person's money moving through. Everything here is exact in whole cents: a part of money is cut with
 * `partCents` and nowhere else, the parts of a row add up to the row, and the lots less the open credit are what the
 * account holds.
 *
 * The trace reads no answer. An answer to "whose money was this?" only relabels the owner of a group or of the
 * opening (`settle`), so no other cent moves. The rows of the real account are made in money-trace-rows.ts.
 */
import { partCents } from "./account-use.ts";
import { pairMoves } from "./money-trace-pairs.ts";
import type { Part } from "./types.ts";

/** Unknown money in is asked about from this sum on (100,00): below it the app does not trouble the household. */
export const ASK_LIMIT = 10000;
/** How many days apart the two legs of a person's movement may be booked. */
export const PAIR_DAYS = 3;
/** Changes when a rule of the trace changes: a trace kept anywhere is built again. */
export const TRACE_VERSION = 1;

/**
 * `u:<user id>` a member; `u:` the holder with no login; `g:<key>` money in that nobody could name (one group per
 * payer); `o` the opening balance; `c` credit.
 */
export type Owner = string;
type LotKind = "own" | "payment" | "pool" | "refund" | "back" | "unknown" | "opening" | "credit" | "before";
/** `passed`: a row for one person took this from another member's money. */
export interface SourcePart {
  owner: Owner;
  kind: LotKind;
  cents: number;
  passed?: true;
}

/**
 * One row of the real account, once, whatever number of copies hold it. `cents` is signed. `key` starts with the
 * day and the sum and ends in the content and the occurrence, so that comparing two keys of one day and one sum is
 * the content order. `group` names the payer of unknown money. `unmatched` is a row only one of two disagreeing
 * copies has: it is unknown whole and neither takes nor makes a lot.
 */
export interface TraceRow {
  key: string;
  ids: readonly string[];
  day: number;
  cents: number;
  pending?: true;
  unmatched?: true;
  group?: Owner;
  from?: { owner: Owner; kind: "own" | "payment" } | { parts: readonly SourcePart[] } | { refundOf: string } | "back";
  /** Money out for one person, or to another pool; absent: for all. */
  to?: { owner: Owner } | "pool";
}

export interface RowParts {
  key: string;
  ids: readonly string[];
  day: number;
  cents: number;
  what: "in" | "one" | "all" | "pool";
  /** The person a `one` row was for. */
  to?: Owner;
  pending?: true;
  /** Positive cents that add up to the row, in the order of the parts. */
  parts: SourcePart[];
}

export interface Trace {
  rows: RowParts[];
  lots: (SourcePart & { tier: 1 | 2 })[];
  /** What each payer paid into the time before the history (an opening below zero). */
  before: SourcePart[];
  groups: { key: string; cents: number; firstDay: number }[];
  openingCents: number;
  openingDay: number;
  openingTaken: boolean;
  /** What the pool owes its own spending: the cents rows took that no money covered yet. */
  creditCents: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Whether an owner is a member or the holder with no login. */
export const isUserOwner = (owner: Owner): boolean => owner.startsWith("u:");
export const sumCents = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

/** The order of the parts: members by id (as code units compare), the holder with no login, groups by key, the opening, credit. */
const ownerRank = (owner: Owner): number => (isUserOwner(owner) ? (owner === "u:" ? 1 : 0) : owner.startsWith("g:") ? 2 : owner === "o" ? 3 : 4);
export const compareOwners = (a: Owner, b: Owner): number => ownerRank(a) - ownerRank(b) || cmp(a, b);

/** `total` cut in proportion to `weights`: the shares add up to the total and none is more than its weight when the total is no more than their sum. */
function cut(total: number, weights: readonly number[]): number[] {
  const of = sumCents(weights);
  if (of <= 0) return weights.map(() => 0);
  let from = 0;
  return weights.map((w) => {
    const part: Part = { from, to: from + w, of };
    from += w;
    return partCents(total, part);
  });
}

interface Lot {
  owner: Owner;
  kind: LotKind;
  tier: 1 | 2;
  cents: number;
  seq: number;
}
/** The live lots of one owner and tier are `lots[head..tail)`, oldest first. */
interface Bucket {
  owner: Owner;
  tier: 1 | 2;
  lots: Lot[];
  head: number;
  tail: number;
  total: number;
}
type Undo = { lot: Lot; cents: number; bucket: Bucket; head: number; tail: number };
type Piece = SourcePart & { tier: 1 | 2 };
interface CreditEntry {
  /** The row paid on credit; null for the opening below zero. */
  rec: RowRec | null;
  left: number;
}
interface RowRec {
  row: TraceRow;
  parts: Piece[];
  /** Cents of each part a refund has returned already, so a second refund cuts what is left. */
  refunded: Map<string, number>;
  /** The credit this row's shortfall opened. */
  entry?: CreditEntry;
  done: boolean;
}

const partKey = (p: Piece): string => `${p.owner}|${p.kind}|${p.passed ? 1 : 0}|${p.tier}`;
/** Adds a part to a list, into the one of the same owner, kind, tier and passing that is there. */
function addPart(list: Piece[], p: Piece): void {
  if (p.cents <= 0) return;
  const same = list.find((q) => partKey(q) === partKey(p));
  if (same) same.cents += p.cents;
  else list.push({ ...p });
}
const byPart = (a: Piece, b: Piece): number => compareOwners(a.owner, b.owner) || cmp(a.kind, b.kind) || a.tier - b.tier || Number(!!a.passed) - Number(!!b.passed);

/**
 * Traces a pool. `openingCents` is the balance before the first booked row (`openingDay`: that row's day); below zero
 * it is a debt of the time before the history. The result is a function of the set of rows, not of their order.
 */
export function trace(rows: readonly TraceRow[], openingCents: number, openingDay: number): Trace {
  const phaseOf = (r: TraceRow): number => (r.cents >= 0 ? 1 : typeof r.to === "object" ? 2 : 3);
  // never the stored id: the day, the phase, the larger sum first, then the content and the occurrence in the key
  const byOrder = (a: TraceRow, b: TraceRow): number => a.day - b.day || phaseOf(a) - phaseOf(b) || Math.abs(b.cents) - Math.abs(a.cents) || cmp(a.key, b.key);
  const sorted = rows.filter((r) => !r.pending).sort(byOrder);
  const pendingRows = rows.filter((r) => r.pending).sort(byOrder);
  const byKey = new Map(sorted.map((r) => [r.key, r]));

  // a refund booked on its purchase's day is read right after the purchase, not among the money in
  const bound = new Map<string, TraceRow[]>();
  const main: TraceRow[] = [];
  for (const r of sorted) {
    const f = r.from;
    const purchase = f && typeof f === "object" && "refundOf" in f ? byKey.get(f.refundOf) : undefined;
    if (purchase && purchase.cents < 0 && purchase.day === r.day && !purchase.unmatched && r.cents > 0) {
      const list = bound.get(purchase.key);
      if (list) list.push(r);
      else bound.set(purchase.key, [r]);
    } else main.push(r);
  }
  const order = main.flatMap((r) => [r, ...(bound.get(r.key) ?? [])]);

  const outOf = pairMoves(order, PAIR_DAYS);

  // state
  const buckets = new Map<string, Bucket>();
  const kept = new Map<string, Lot[]>();
  const groups = new Map<string, { key: string; cents: number; firstDay: number }>();
  const recs = new Map<string, RowRec>();
  const credit: CreditEntry[] = [];
  const before = new Map<Owner, number>();
  let creditHead = 0;
  let creditTotal = 0;
  let seq = 0;
  let journal: Undo[] | null = null;

  const bucketOf = (tier: 1 | 2, owner: Owner): Bucket => {
    const k = `${tier}|${owner}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = { owner, tier, lots: [], head: 0, tail: 0, total: 0 }));
    return b;
  };
  const live = (tier: 1 | 2): Bucket[] => [...buckets.values()].filter((b) => b.tier === tier && b.total > 0).sort((a, b) => compareOwners(a.owner, b.owner));
  const newLot = (owner: Owner, kind: LotKind, tier: 1 | 2, cents: number): Lot => ({ owner, kind, tier, cents, seq: ++seq });
  const addLot = (lot: Lot): void => {
    const b = bucketOf(lot.tier, lot.owner);
    b.lots.length = b.tail;
    b.lots.push(lot);
    b.tail++;
    b.total += lot.cents;
  };

  /** Takes `n` cents from the live lots of a bucket, oldest or newest first; returns the cents the bucket could not give. */
  const consume = (b: Bucket, n: number, end: "old" | "new", out: Piece[], passed: boolean): number => {
    while (n > 0 && b.head < b.tail) {
      const lot = end === "old" ? b.lots[b.head]! : b.lots[b.tail - 1]!;
      const t = Math.min(n, lot.cents);
      journal?.push({ lot, cents: t, bucket: b, head: b.head, tail: b.tail });
      lot.cents -= t;
      b.total -= t;
      n -= t;
      addPart(out, { owner: lot.owner, kind: lot.kind, cents: t, tier: lot.tier, ...(passed ? { passed: true as const } : {}) });
      while (b.head < b.tail && b.lots[b.head]!.cents === 0) b.head++;
      while (b.head < b.tail && b.lots[b.tail - 1]!.cents === 0) b.tail--;
    }
    return n;
  };
  const undo = (): void => {
    for (const u of (journal ?? []).reverse()) {
      u.lot.cents += u.cents;
      u.bucket.total += u.cents;
      u.bucket.head = u.head;
      u.bucket.tail = u.tail;
    }
  };
  const cutTake = (bs: Bucket[], amount: number, out: Piece[]): void => {
    const shares = cut(
      amount,
      bs.map((b) => b.total),
    );
    bs.forEach((b, i) => {
      // a rounded share never exceeds what its owner has: this is the check that it never does
      if (consume(b, shares[i]!, "old", out, false) > 0) throw new Error("a share is larger than what its owner holds");
    });
  };

  /** Money out for all: the rows' lots in proportion, then small unknown money, the opening last. */
  const takeAll = (amount: number): { parts: Piece[]; short: number } => {
    const parts: Piece[] = [];
    let left = amount;
    const stage = (bs: Bucket[]): void => {
      const total = sumCents(bs.map((b) => b.total));
      if (total >= left) {
        cutTake(bs, left, parts);
        left = 0;
      } else {
        for (const b of bs) consume(b, b.total, "old", parts, false);
        left -= total;
      }
    };
    stage(live(1));
    if (left > 0) stage(live(2).filter((b) => b.owner !== "o"));
    if (left > 0) {
      const opening = buckets.get("2|o");
      if (opening) left = consume(opening, left, "old", parts, false);
    }
    return { parts, short: left };
  };

  /** Takes the newest lot first across the buckets of a tier, leaving out one owner's. */
  const newestAcross = (tier: 1 | 2, person: Owner, left: number, parts: Piece[]): number => {
    while (left > 0) {
      let best: Bucket | null = null;
      for (const b of buckets.values()) {
        if (b.tier !== tier || b.owner === person || b.head >= b.tail) continue;
        if (!best || b.lots[b.tail - 1]!.seq > best.lots[best.tail - 1]!.seq) best = b;
      }
      if (!best) break;
      const n = Math.min(left, best.lots[best.tail - 1]!.cents);
      consume(best, n, "new", parts, isUserOwner(best.owner));
      left -= n;
    }
    return left;
  };
  /** Money out for one person: the kept lots of their pair, their own lots, others' tier 1, then tier 2, each newest first. */
  const takeOne = (person: Owner, amount: number, keptLots: readonly Lot[]): { parts: Piece[]; short: number } => {
    const parts: Piece[] = [];
    let left = amount;
    for (const lot of keptLots) {
      const t = Math.min(left, lot.cents);
      if (t <= 0) continue;
      lot.cents -= t;
      left -= t;
      addPart(parts, { owner: lot.owner, kind: lot.kind, cents: t, tier: lot.tier, ...(isUserOwner(lot.owner) && lot.owner !== person ? { passed: true as const } : {}) });
    }
    const mine = buckets.get(`1|${person}`);
    if (mine) left = consume(mine, left, "new", parts, false);
    left = newestAcross(1, person, left, parts);
    left = newestAcross(2, person, left, parts);
    return { parts, short: left };
  };

  // the mix of the pool at the end of the day before: what money back is shared by
  const backDays = new Set(order.filter((r) => r.from === "back" || (typeof r.from === "object" && "refundOf" in r.from)).map((r) => r.day));
  const snapshot = (): { owner: Owner; tier: 1 | 2; cents: number }[] =>
    [...buckets.values()]
      .filter((b) => b.total > 0)
      .map((b) => ({ owner: b.owner, tier: b.tier, cents: b.total }))
      .sort((a, b) => compareOwners(a.owner, b.owner) || a.tier - b.tier);
  let dayMix: { owner: Owner; tier: 1 | 2; cents: number }[] | null = null;

  const bumpGroup = (key: Owner, cents: number, day: number): number => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, cents: 0, firstDay: day }));
    g.cents += cents;
    return g.cents;
  };
  const unknownParts = (row: TraceRow, n: number, commit: boolean): Piece[] => {
    if (n <= 0) return [];
    const key = row.group ?? "g:text:";
    const running = commit ? bumpGroup(key, n, row.day) : (groups.get(key)?.cents ?? 0) + n;
    return [{ owner: key, kind: "unknown", cents: n, tier: running >= ASK_LIMIT ? 1 : 2 }];
  };
  const backParts = (row: TraceRow, n: number, commit: boolean): Piece[] => {
    const mix = commit && dayMix ? dayMix : snapshot();
    const shares = cut(
      n,
      mix.map((m) => m.cents),
    );
    if (!mix.length || sumCents(shares) === 0) return unknownParts(row, n, commit);
    return mix.map((m, i): Piece => ({ owner: m.owner, kind: "back", cents: shares[i]!, tier: m.tier })).filter((p) => p.cents > 0);
  };
  /** A refund: what a purchase took comes back in proportion to its parts as they stand. */
  const refundParts = (row: TraceRow, purchaseKey: string, n: number, commit: boolean): Piece[] => {
    const pr = recs.get(purchaseKey);
    if (!pr || !pr.done || pr.row.cents >= 0 || pr.row.pending) return backParts(row, n, commit);
    const stand = [...pr.parts].sort(byPart).map((p) => ({ p, rest: p.cents - (pr.refunded.get(partKey(p)) ?? 0) }));
    const room = sumCents(stand.map((s) => s.rest));
    const take = Math.min(n, room);
    const out: Piece[] = [];
    const shares = cut(
      take,
      stand.map((s) => s.rest),
    );
    stand.forEach((s, i) => {
      const cents = shares[i]!;
      if (cents <= 0) return;
      if (commit) {
        pr.refunded.set(partKey(s.p), (pr.refunded.get(partKey(s.p)) ?? 0) + cents);
        if (s.p.owner === "c") {
          // the refund cancels the credit the purchase was paid on
          const entry = pr.entry;
          const cancel = entry ? Math.min(entry.left, cents) : 0;
          if (entry) entry.left -= cancel;
          creditTotal -= cancel;
        }
      }
      const kind: LotKind = s.p.owner === "c" ? "credit" : s.p.kind === "opening" ? "opening" : "refund";
      addPart(out, { owner: s.p.owner, kind, cents, tier: s.p.tier });
    });
    for (const p of backParts(row, n - take, commit)) addPart(out, p);
    return out;
  };
  /** The parts of money in, whole, in the order of the parts. */
  const sourceParts = (row: TraceRow, commit: boolean): Piece[] => {
    const n = Math.abs(row.cents);
    const f = row.from;
    let ps: Piece[];
    if (row.unmatched) ps = [{ owner: "g:text:unmatched", kind: "unknown", cents: n, tier: 2 }];
    else if (!f) ps = unknownParts(row, n, commit);
    else if (f === "back") ps = backParts(row, n, commit);
    else if ("owner" in f) ps = [{ owner: f.owner, kind: f.kind, cents: n, tier: 1 }];
    else if ("refundOf" in f) ps = refundParts(row, f.refundOf, n, commit);
    else {
      ps = [];
      let left = n;
      for (const p of f.parts) {
        const t = Math.min(left, p.cents);
        if (t <= 0) continue;
        addPart(ps, { owner: p.owner, kind: p.kind, cents: t, tier: 1 });
        if (commit && p.owner.startsWith("g:")) bumpGroup(p.owner, t, row.day);
        left -= t;
      }
      for (const p of unknownParts(row, left, commit)) addPart(ps, p);
    }
    return ps.sort(byPart);
  };

  // the opening
  if (openingCents > 0) addLot(newLot("o", "opening", 2, openingCents));
  if (openingCents < 0) {
    credit.push({ rec: null, left: -openingCents });
    creditTotal = -openingCents;
  }

  /** The next money in fills the credit first, by its owners in proportion; the rows paid on credit get those payers. */
  const fillCredit = (lotable: Piece[]): Piece[] => {
    const fill = Math.min(creditTotal, sumCents(lotable.map((p) => p.cents)));
    if (fill <= 0) return lotable;
    const shares = cut(
      fill,
      lotable.map((p) => p.cents),
    );
    const pieces = lotable.map((p, i) => ({ p, left: shares[i]! }));
    let at = 0;
    while (at < pieces.length) {
      while (creditHead < credit.length && credit[creditHead]!.left === 0) creditHead++;
      const e = credit[creditHead];
      const piece = pieces[at]!;
      if (!e) break;
      if (piece.left === 0) {
        at++;
        continue;
      }
      const t = Math.min(e.left, piece.left);
      e.left -= t;
      piece.left -= t;
      creditTotal -= t;
      if (e.rec) {
        const c = e.rec.parts.find((q) => q.owner === "c");
        if (c) c.cents -= t;
        e.rec.parts = e.rec.parts.filter((q) => q.cents > 0);
        addPart(e.rec.parts, { owner: piece.p.owner, kind: piece.p.kind, cents: t, tier: piece.p.tier });
        e.rec.parts.sort(byPart);
      } else before.set(piece.p.owner, (before.get(piece.p.owner) ?? 0) + t);
    }
    return lotable.map((p, i) => ({ ...p, cents: p.cents - shares[i]! })).filter((p) => p.cents > 0);
  };

  const outParts = (row: TraceRow, keptLots: readonly Lot[]): Piece[] => {
    const amount = -row.cents;
    const plan = typeof row.to === "object" ? takeOne(row.to.owner, amount, keptLots) : takeAll(amount);
    if (plan.short > 0) addPart(plan.parts, { owner: "c", kind: "credit", cents: plan.short, tier: 1 });
    return plan.parts.sort(byPart);
  };

  let day = Number.NaN;
  for (const row of order) {
    if (row.day !== day) {
      day = row.day;
      dayMix = backDays.has(day) ? snapshot() : null;
    }
    const rec: RowRec = { row, parts: [], refunded: new Map(), done: false };
    recs.set(row.key, rec);
    if (row.cents === 0) {
      rec.done = true;
      continue;
    }
    if (row.unmatched) rec.parts = sourceParts(row, true);
    else if (row.cents > 0) {
      rec.parts = sourceParts(row, true);
      const keptKey = outOf.get(row.key);
      const lotable = fillCredit(rec.parts.filter((p) => p.owner !== "c"));
      for (const p of lotable) {
        const lot = newLot(p.owner, p.kind, p.tier, p.cents);
        if (keptKey !== undefined) {
          const list = kept.get(keptKey);
          if (list) list.push(lot);
          else kept.set(keptKey, [lot]);
        } else addLot(lot);
      }
    } else {
      rec.parts = outParts(row, kept.get(row.key) ?? []);
      const short = rec.parts.find((p) => p.owner === "c")?.cents ?? 0;
      if (short > 0) {
        rec.entry = { rec, left: short };
        credit.push(rec.entry);
        creditTotal += short;
      }
    }
    rec.done = true;
  }

  // pending rows get parts against the lots after the last booked row and take nothing
  for (const row of pendingRows) {
    const rec: RowRec = { row, parts: [], refunded: new Map(), done: false };
    if (row.cents > 0) rec.parts = sourceParts(row, false);
    else if (row.cents < 0) {
      journal = [];
      rec.parts = outParts(row, []);
      undo();
      journal = null;
    }
    recs.set(row.key, rec);
  }

  const out = [...order, ...pendingRows].map((r): RowParts => {
    const rec = recs.get(r.key)!;
    const what = r.cents >= 0 ? "in" : r.to === "pool" ? "pool" : typeof r.to === "object" ? "one" : "all";
    const parts = [...rec.parts].sort(byPart).map((p): SourcePart => ({ owner: p.owner, kind: p.kind, cents: p.cents, ...(p.passed ? { passed: true as const } : {}) }));
    return { key: r.key, ids: r.ids, day: r.day, cents: r.cents, what, ...(typeof r.to === "object" ? { to: r.to.owner } : {}), ...(r.pending ? { pending: true as const } : {}), parts };
  });
  const lots = [...[...buckets.values()].flatMap((b) => b.lots.slice(b.head, b.tail)), ...[...kept.values()].flat()]
    .filter((l) => l.cents > 0)
    .sort((a, b) => a.seq - b.seq)
    .map((l) => ({ owner: l.owner, kind: l.kind, cents: l.cents, tier: l.tier }));
  const openingTaken = order.some((r) => recs.get(r.key)!.parts.some((p) => p.owner === "o"));
  return {
    rows: out,
    lots,
    before: [...before].map(([owner, cents]): SourcePart => ({ owner, kind: "before", cents })).sort((a, b) => compareOwners(a.owner, b.owner)),
    groups: [...groups.values()].sort((a, b) => cmp(a.key, b.key)),
    openingCents,
    openingDay,
    openingTaken,
    creditCents: creditTotal,
  };
}
