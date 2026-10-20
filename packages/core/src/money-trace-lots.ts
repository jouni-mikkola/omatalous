/**
 * The parts of a trace: the types of its rows and lots, the order of owners, and the lots' bookkeeping. The trace itself
 * is money-trace.ts.
 */
import { partCents } from "./account-use.ts";
import type { Part } from "./types.ts";

/** `u:<id>` a member; `m:<id>` a household member with no login; `u:` a holder nobody names; `g:<key>` money in nobody could name (a group per payer); `o` the opening; `c` credit. */
export type Owner = string;
export type LotKind = "own" | "payment" | "pool" | "refund" | "back" | "unknown" | "opening" | "credit" | "before";
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
  /** A bill paid to a card account: the card's account key, whoever the bill is for. */
  cardKey?: string;
}

/** Cents of an earlier row's credit that a deposit paid for one owner. */
export interface CreditFill {
  key: string;
  owner: Owner;
  cents: number;
}

export interface RowParts {
  key: string;
  ids: readonly string[];
  day: number;
  cents: number;
  what: "in" | "one" | "all" | "pool";
  /** The person a `one` row was for. */
  to?: Owner;
  /** A refund of a `one` row: the person the refunded row was for. What it gives back is what that row took. */
  refundFor?: Owner;
  /** A refund: the key of the row it gives back (of any kind, whether or not it took anything). */
  refundOf?: string;
  /** Money out: the cents that were on credit on the row's own day, whatever a later deposit paid of them. */
  onCredit?: number;
  /** Money in: what it paid of earlier rows' credit, by row and payer. */
  fills?: CreditFill[];
  /** A bill paid to a card account: the card's account key. */
  cardKey?: string;
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

export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Whether an owner is a member (`u:<id>`, `m:<id>`) or the holder with no login. */
export const isUserOwner = (owner: Owner): boolean => owner.startsWith("u:") || owner.startsWith("m:");
export const sumCents = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

/** The order of the parts: members by key (as code units compare), the holder nobody names, groups by key, the opening, credit. */
const ownerRank = (owner: Owner): number => (isUserOwner(owner) ? (owner === "u:" ? 1 : 0) : owner.startsWith("g:") ? 2 : owner === "o" ? 3 : 4);
export const compareOwners = (a: Owner, b: Owner): number => ownerRank(a) - ownerRank(b) || cmp(a, b);

/** `total` cut in proportion to `weights`: the shares add up to the total and none is more than its weight when the total is no more than their sum. */
export function cut(total: number, weights: readonly number[]): number[] {
  const of = sumCents(weights);
  if (of <= 0) return weights.map(() => 0);
  let from = 0;
  return weights.map((w) => {
    const part: Part = { from, to: from + w, of };
    from += w;
    return partCents(total, part);
  });
}

export interface Lot {
  owner: Owner;
  kind: LotKind;
  tier: 1 | 2;
  cents: number;
  seq: number;
}
/** The live lots of one owner and tier are `lots[head..tail)`, oldest first. */
export interface Bucket {
  owner: Owner;
  tier: 1 | 2;
  lots: Lot[];
  head: number;
  tail: number;
  total: number;
}
export type Undo = { lot: Lot; cents: number; bucket: Bucket; head: number; tail: number };
export type Piece = SourcePart & { tier: 1 | 2 };
export interface CreditEntry {
  /** The row paid on credit; null for the opening below zero. */
  rec: RowRec | null;
  left: number;
}
export interface RowRec {
  row: TraceRow;
  parts: Piece[];
  /** Cents of each part a refund has returned already, so a second refund cuts what is left. */
  refunded: Map<string, number>;
  /** The credit this row's shortfall opened. */
  entry?: CreditEntry;
  /** The cents of that shortfall, as they were when the row was read. */
  onCredit?: number;
  /** Money in: what it paid of earlier rows' credit. */
  fills?: CreditFill[];
  done: boolean;
}

export const partKey = (p: Piece): string => `${p.owner}|${p.kind}|${p.passed ? 1 : 0}|${p.tier}`;
/** Adds a part to a list, into the one of the same owner, kind, tier and passing that is there. */
export function addPart(list: Piece[], p: Piece): void {
  if (p.cents <= 0) return;
  const same = list.find((q) => partKey(q) === partKey(p));
  if (same) same.cents += p.cents;
  else list.push({ ...p });
}
export const byPart = (a: Piece, b: Piece): number => compareOwners(a.owner, b.owner) || cmp(a.kind, b.kind) || a.tier - b.tier || Number(!!a.passed) - Number(!!b.passed);
