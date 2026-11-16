/**
 * What an answer to "whose money was this?" does to a trace, and what a viewer sees of it. An answer relabels the owner
 * of a group or of the opening and moves no other cent; the questions that stand are the groups and the opening still
 * unanswered. See money-trace.ts for the trace itself.
 */
import { partCents } from "./account-use.ts";
import {
  ASK_LIMIT,
  compareOwners,
  type CreditFill,
  isPoolMoney,
  isSharedCredit,
  isUserOwner,
  type Owner,
  type RowParts,
  type SourcePart,
  sumCents,
  type Trace,
} from "./money-trace.ts";
import type { Part } from "./types.ts";

export interface Answer {
  kind: "in" | "opening";
  key: string;
  owner: Owner | "all" | "none";
}
export interface Question {
  kind: "in" | "opening";
  key: string;
  cents: number;
  day: number;
  openCents: number;
}
export interface TraceUser {
  owner: Owner;
  weight: number;
}

/** The parts of the account's users in the order of the parts, at their weights. */
function usersPart(users: readonly TraceUser[]): { owner: Owner; part: Part }[] {
  const list = users.filter((u) => u.weight > 0).sort((a, b) => compareOwners(a.owner, b.owner));
  const of = sumCents(list.map((u) => u.weight));
  let from = 0;
  return list.map((u) => {
    const part: Part = { from, to: from + u.weight, of };
    from += u.weight;
    return { owner: u.owner, part };
  });
}

/** What the answers say, by the owner they relabel; "none" says nothing. */
function answered(answers: readonly Answer[]): Map<Owner, Owner | "all"> {
  const map = new Map<Owner, Owner | "all">();
  for (const a of answers) if (a.owner !== "none" && (a.kind === "opening") === (a.key === "o")) map.set(a.key, a.owner);
  return map;
}

/**
 * Relabels the groups and the opening to the owners the answers name; no other cent moves. "all" cuts a part over the
 * account's users at their weights. A part an answer gives to another member than the person a row was for was
 * passed; one it gives to that person was not.
 */
export function settle(t: Trace, answers: readonly Answer[], users: readonly TraceUser[]): Trace {
  const map = answered(answers);
  if (!map.size) return t;
  const shares = usersPart(users);
  const relabel = (p: SourcePart, person?: Owner): SourcePart[] => {
    const to = map.get(p.owner);
    if (to === undefined) return [p];
    const targets = to === "all" ? shares.map((s) => ({ owner: s.owner, cents: partCents(p.cents, s.part) })).filter((s) => s.cents > 0) : [{ owner: to, cents: p.cents }];
    if (!targets.length) return [p];
    return targets.map((s): SourcePart => {
      const passed = person !== undefined && isUserOwner(s.owner) && s.owner !== person;
      return { owner: s.owner, kind: p.kind, cents: s.cents, ...(passed ? { passed: true as const } : {}) };
    });
  };
  /** What a deposit paid of earlier credit, by the owners the answers name: the same cents, relabeled as its parts are. */
  const refilled = (fills: readonly CreditFill[]): CreditFill[] => {
    const out: CreditFill[] = [];
    for (const f of fills) {
      for (const p of relabel({ owner: f.owner, kind: "unknown", cents: f.cents })) {
        const same = out.find((o) => o.key === f.key && o.owner === p.owner);
        if (same) same.cents += p.cents;
        else out.push({ key: f.key, owner: p.owner, cents: p.cents });
      }
    }
    return out;
  };
  return {
    ...t,
    rows: t.rows.map((r) => ({ ...r, parts: r.parts.flatMap((p) => relabel(p, r.what === "one" ? r.to : undefined)), ...(r.fills ? { fills: refilled(r.fills) } : {}) })),
    lots: t.lots.flatMap((l) => relabel(l).map((p) => ({ ...p, tier: l.tier }))),
    before: t.before.flatMap((p) => relabel(p)),
  };
}

/** The groups a question stands for: unknown money of the asking sum nobody answered. Shared credit and money between the household's own pools are never asked. */
const askedGroups = (t: Trace, said: ReadonlySet<string>) => t.groups.filter((g) => g.cents >= ASK_LIMIT && !said.has(g.key) && !isSharedCredit(g.key) && !isPoolMoney(g.key));

/**
 * Whether the opening is asked: unanswered, and the booked payments spent at least `ASK_LIMIT` of it. The sum is of the
 * opening's parts on booked outgoing rows, as `openingTaken` is: a pending row takes nothing and an incoming row's
 * opening part is a refund coming back. A smaller part stays unknown money and no question stands for it.
 */
const openingAsked = (t: Trace, said: ReadonlySet<string>): boolean =>
  t.openingTaken &&
  !said.has("o") &&
  sumCents(t.rows.filter((r) => !r.pending && r.cents < 0).flatMap((r) => r.parts.filter((p) => p.owner === "o").map((p) => p.cents))) >= ASK_LIMIT;

/** Whether a part is one a question stands for: unknown money of an unanswered group of the asking sum, or the unanswered opening once booked payments spent `ASK_LIMIT` of it. */
export function openOf(t: Trace, answers: readonly Answer[]): (p: SourcePart) => boolean {
  const said = new Set(answers.map((a) => a.key));
  const asked = new Set(askedGroups(t, said).map((g) => g.key));
  const opening = openingAsked(t, said);
  return (p) => (p.owner === "o" ? opening : asked.has(p.owner));
}

/** The questions that stand, the one with most open cents first. */
export function questionsOf(t: Trace, answers: readonly Answer[]): Question[] {
  const open = openOf(t, answers);
  const openBy = new Map<Owner, number>();
  for (const r of t.rows) for (const p of r.parts) if (open(p)) openBy.set(p.owner, (openBy.get(p.owner) ?? 0) + p.cents);
  const said = new Set(answers.map((a) => a.key));
  const questions: Question[] = askedGroups(t, said).map((g) => ({ kind: "in", key: g.key, cents: g.cents, day: g.firstDay, openCents: openBy.get(g.key) ?? 0 }));
  if (openingAsked(t, said)) questions.push({ kind: "opening", key: "o", cents: t.openingCents, day: t.openingDay, openCents: openBy.get("o") ?? 0 });
  return questions.sort((a, b) => b.openCents - a.openCents || compareOwners(a.key, b.key));
}

/**
 * What the parts of a row say of who paid it, in positive cents: the viewer's own, all that belongs to a user (the
 * viewer's included), the row's whole, and what belongs to the users whose owner key sorts before the viewer's. The rest
 * of the whole is money nobody owns. Members place their own cents one after the other in the order of their keys, so
 * the parts the forward cut gives them never overlap.
 */
export interface PaidOf {
  own: number;
  known: number;
  whole: number;
  before: number;
}

/** The one reading of a row's parts by owner: `shareOf` takes the viewer's cents from it, and the forward cut (`standing-cut.ts`) reads the same evidence. */
function paidOf(row: Pick<RowParts, "parts">, viewer: Owner): PaidOf {
  let own = 0;
  let known = 0;
  let whole = 0;
  let before = 0;
  for (const p of row.parts) {
    whole += p.cents;
    if (isUserOwner(p.owner)) {
      known += p.cents;
      if (compareOwners(p.owner, viewer) < 0) before += p.cents;
    }
    if (p.owner === viewer) own += p.cents;
  }
  return { own, known, whole, before };
}

/** What the parts of each booked row say of who paid it, by the id of the row on each copy of the account: the evidence the forward cut of a series is made from. */
export function paidRows(rows: readonly RowParts[], viewer: Owner): Map<string, PaidOf> {
  const paid = new Map<string, PaidOf>();
  for (const row of rows) {
    if (row.pending || !row.parts.length) continue;
    const own = paidOf(row, viewer);
    for (const id of row.ids) paid.set(id, own);
  }
  return paid;
}

/**
 * One viewer's signed cents of a row: the parts that are theirs and their part of the unknown ones, with the row's
 * sign. `openCents` (signed like `cents`) is their part of the parts a question stands for. A transfer is money in from
 * a person's own account, a payment by a person or another pool, and money out for one person or to a pool.
 */
export function shareOf(row: RowParts, viewer: Owner, part: Part, open: (p: SourcePart) => boolean): { cents: number; openCents: number; transfer: boolean } {
  const sign = row.cents < 0 ? -1 : 1;
  const { own } = paidOf(row, viewer);
  let unknown = 0;
  let asked = 0;
  for (const p of row.parts) {
    if (p.owner !== viewer && !isUserOwner(p.owner)) {
      unknown += p.cents;
      if (open(p)) asked += p.cents;
    }
  }
  const moved = row.what === "in" && row.parts.length > 0 && row.parts.every((p) => p.kind === "own" || p.kind === "payment" || p.kind === "pool");
  return { cents: sign * own + partCents(sign * unknown, part), openCents: partCents(sign * asked, part), transfer: row.what === "one" || row.what === "pool" || moved };
}

/** Weights in whole percents that add up to 100, the percents left over going to the largest remainders: the rounding `sharesText` states. */
function wholePercents(weights: readonly number[]): number[] {
  const total = sumCents(weights.filter((w) => w > 0));
  if (!total) return weights.map(() => 0);
  const at = weights.flatMap((w, i) => (w > 0 ? [i] : []));
  const exact = at.map((i) => (weights[i]! * 100) / total);
  const whole = exact.map(Math.floor);
  const order = exact.map((x, i) => ({ i, rest: x - whole[i]! })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order.slice(0, 100 - sumCents(whole))) whole[i]!++;
  const percents = weights.map(() => 0);
  at.forEach((w, k) => {
    percents[w] = whole[k]!;
  });
  return percents;
}

/**
 * The conditions of setting an account's split by the money trace, over a window of day numbers, and the traced split
 * of the window: each user's share of the cost rows for all, in whole percents. `c3`: the history reaches the first
 * day of the window. `c4`: the window holds a cost row for all and none has an unknown part (after the answers).
 * `c5`: no part of a window row got its owner from an answer.
 */
export function splitOf(
  t: Trace,
  answers: readonly Answer[],
  users: readonly TraceUser[],
  window: { from: number; to: number },
): { c3: boolean; c4: boolean; c5: boolean; percents: { owner: Owner; percent: number }[] } {
  const inWindow = (r: RowParts): boolean => !r.pending && r.day >= window.from && r.day <= window.to;
  const costs = settle(t, answers, users).rows.filter((r) => inWindow(r) && r.what === "all");
  const said = answered(answers);
  const owners = users.map((u) => u.owner).sort(compareOwners);
  const percents = wholePercents(owners.map((owner) => sumCents(costs.flatMap((r) => r.parts.filter((p) => p.owner === owner).map((p) => p.cents)))));
  return {
    c3: t.openingDay <= window.from,
    c4: costs.length > 0 && costs.every((r) => r.parts.every((p) => isUserOwner(p.owner))),
    c5: !t.rows.some((r) => inWindow(r) && r.parts.some((p) => said.has(p.owner))),
    percents: owners.map((owner, i) => ({ owner, percent: percents[i]! })),
  };
}
