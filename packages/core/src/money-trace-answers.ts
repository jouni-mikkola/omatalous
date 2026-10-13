/**
 * What an answer to "whose money was this?" does to a trace, and what a viewer sees of it. An answer relabels the owner
 * of a group or of the opening and moves no other cent; the questions that stand are the groups and the opening still
 * unanswered. See money-trace.ts for the trace itself.
 */
import { partCents } from "./account-use.ts";
import {
  ASK_LIMIT,
  compareOwners,
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
  return {
    ...t,
    rows: t.rows.map((r) => ({ ...r, parts: r.parts.flatMap((p) => relabel(p, r.what === "one" ? r.to : undefined)) })),
    lots: t.lots.flatMap((l) => relabel(l).map((p) => ({ ...p, tier: l.tier }))),
    before: t.before.flatMap((p) => relabel(p)),
  };
}

/** Whether a part is one a question stands for: unknown money of an unanswered group of the asking sum, or the unanswered opening once a row took it. */
export function openOf(t: Trace, answers: readonly Answer[]): (p: SourcePart) => boolean {
  const said = new Set(answers.map((a) => a.key));
  const asked = new Set(t.groups.filter((g) => g.cents >= ASK_LIMIT && !said.has(g.key)).map((g) => g.key));
  return (p) => (p.owner === "o" ? t.openingTaken && !said.has("o") : asked.has(p.owner));
}

/** The questions that stand, the one with most open cents first. */
export function questionsOf(t: Trace, answers: readonly Answer[]): Question[] {
  const open = openOf(t, answers);
  const openBy = new Map<Owner, number>();
  for (const r of t.rows) for (const p of r.parts) if (open(p)) openBy.set(p.owner, (openBy.get(p.owner) ?? 0) + p.cents);
  const said = new Set(answers.map((a) => a.key));
  const questions: Question[] = t.groups.filter((g) => g.cents >= ASK_LIMIT && !said.has(g.key)).map((g) => ({ kind: "in", key: g.key, cents: g.cents, day: g.firstDay, openCents: openBy.get(g.key) ?? 0 }));
  if (t.openingTaken && !said.has("o")) questions.push({ kind: "opening", key: "o", cents: t.openingCents, day: t.openingDay, openCents: openBy.get("o") ?? 0 });
  return questions.sort((a, b) => b.openCents - a.openCents || compareOwners(a.key, b.key));
}

/**
 * One viewer's signed cents of a row: the parts that are theirs and their part of the unknown ones, with the row's
 * sign. `openCents` (signed like `cents`) is their part of the parts a question stands for. A transfer is money in from
 * a person's own account, a payment by a person or another pool, and money out for one person or to a pool.
 */
export function shareOf(row: RowParts, viewer: Owner, part: Part, open: (p: SourcePart) => boolean): { cents: number; openCents: number; transfer: boolean } {
  const sign = row.cents < 0 ? -1 : 1;
  let own = 0;
  let unknown = 0;
  let asked = 0;
  for (const p of row.parts) {
    if (p.owner === viewer) own += p.cents;
    else if (!isUserOwner(p.owner)) {
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
