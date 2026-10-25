/**
 * The books of a settlement between partners: the cost rows of a pool read at their own day, the refunds that net them,
 * the deposits that paid earlier credit, how each cost is shared, and when a month closes. Reads the trace and what is
 * passed in; no database, no clock. The month itself is put together in settlement.ts.
 */
import { type CardUse, cardHolderOf } from "./card-holder.ts";
import { addMonths, dayNumber, fromDayNumber } from "./dates.ts";
import { type Answer, settle, type TraceUser } from "./money-trace-answers.ts";
import { compareOwners, type Owner, type RowParts, type SourcePart, type Trace } from "./money-trace.ts";
import { type AgreementRow, agreementOn, agreementWeights, fixedOf, type Incomes, type Weight, type Weighted } from "./settlement-agreements.ts";

/** Days after a month's last day on which it closes whatever is still unknown (a made-up default). */
export const CLOSE_DAYS = 90;

/** An answer to "whose money was this?" and the day it was said. One answer per key: the one that stands now. */
export interface SaidAnswer extends Answer {
  saidOn: string;
}

/** The pool: its account key, its trace NOT settled by answers (they are applied here, by day), and its users' weights as said now. */
export interface SettlementPool {
  key: string;
  trace: Trace;
  answers: readonly SaidAnswer[];
  users: readonly TraceUser[];
  /** "unknown": the weights come from the holder names and nobody said the split (`AccountUse.split`), so a cost no agreement covers has no shares (ADR 0017). */
  split?: "unknown";
}

/** Cents on the paying side, signed: members' own and the unknown owners' (`g:`, `o`, `c`, `u:`). */
export interface Entry {
  owner: Owner;
  cents: number;
}

/** How a cost is shared (`key`: the account whose agreement it is; `fell`: a card agreement named nobody left and the card's own use stood in): `one` a person's whole, `split` by weights (`inC`: it counts in a fixed month's net cost), `unknown` left out (`untold`: the pool's split is not told and no agreement covers the cost). */
type Treat = ({ t: "one"; owner: Owner } | { t: "unknown"; untold?: true } | { t: "split"; w: Weighted; inC: boolean; key: string }) & { fell?: true };

/** What one row puts on the paying side: a cost (positive), a refund that nets one (negative), a deposit that paid credit (zero in all). */
export interface Raw {
  kind: "cost" | "refund" | "credit_filled";
  row: RowParts;
  /** The cost row a refund nets or a deposit paid. */
  of?: RowParts;
  parts: Entry[];
}

export const merge = (entries: readonly Entry[]): Entry[] => {
  const by = new Map<Owner, number>();
  for (const e of entries) by.set(e.owner, (by.get(e.owner) ?? 0) + e.cents);
  return [...by].map(([owner, cents]) => ({ owner, cents })).filter((e) => e.cents !== 0).sort((a, b) => compareOwners(a.owner, b.owner));
};

// The ledger asks the month of every row for every month it works out, and an ISO string from Date was most of the time
// of a long joint account's answer, so the months are kept by day number (a household's days are a few thousand).
const MONTHS_BY_DAY = new Map<number, string>();
export const monthOfDay = (day: number): string => {
  let month = MONTHS_BY_DAY.get(day);
  if (month === undefined) {
    if (MONTHS_BY_DAY.size >= 100_000) MONTHS_BY_DAY.clear();
    month = fromDayNumber(day).slice(0, 7);
    MONTHS_BY_DAY.set(day, month);
  }
  return month;
};
export const monthLast = (month: string): number => dayNumber(`${addMonths(month, 1)}-01`) - 1;
const isCost = (r: RowParts): boolean => r.cents < 0 && !r.pending && (r.what === "all" || r.what === "one");
const NETTING = new Set(["refund", "credit", "opening"]);

export function makeBook(pool: SettlementPool, agreements: readonly AgreementRow[], members: ReadonlySet<Owner>, cards: readonly CardUse[], incomes: Incomes, asOfDay: number) {
  const users: Weight[] = pool.users.filter((u) => u.weight > 0).map((u) => ({ owner: u.owner, weight: u.weight }));
  const cardByKey = new Map(cards.map((c) => [c.key, c]));
  const perRow = agreements.filter((a) => a.kind !== "fixed");
  const rows = pool.trace.rows;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const fillsOn = new Map<string, { day: number; owner: Owner; cents: number }[]>();
  const cancels = new Map<string, { day: number; cents: number }[]>();
  const pendingFor = new Set<string>();
  const byMonth = new Map<string, RowParts[]>();
  const push = <T>(m: Map<string, T[]>, k: string, v: T): void => void (m.get(k)?.push(v) ?? m.set(k, [v]));
  const eventDays = new Set<number>(pool.answers.map((a) => dayNumber(a.saidOn)));
  for (const r of rows) {
    if (r.pending) {
      if (r.refundOf) pendingFor.add(r.refundOf);
      continue;
    }
    push(byMonth, monthOfDay(r.day), r);
    for (const f of r.fills ?? []) {
      push(fillsOn, f.key, { day: r.day, owner: f.owner, cents: f.cents });
      eventDays.add(r.day);
    }
    const cancel = r.refundOf ? r.parts.filter((p) => p.owner === "c").reduce((s, p) => s + p.cents, 0) : 0;
    if (cancel > 0) {
      push(cancels, r.refundOf!, { day: r.day, cents: cancel });
      eventDays.add(r.day);
    }
  }
  for (const list of byMonth.values()) list.sort((a, b) => a.day - b.day || (a.key < b.key ? -1 : 1));
  const months = [...byMonth.keys()].sort();

  const treats = new Map<string, Treat>();
  const treatOf = (r: RowParts): Treat => {
    let t = treats.get(r.key);
    if (!t) treats.set(r.key, (t = work(r)));
    return t;
  };
  const split = (a: AgreementRow | undefined, day: number, inC: boolean, key: string): Treat => ({ t: "split", w: agreementWeights(a, users, incomes, monthOfDay(day)), inC, key });
  function work(r: RowParts): Treat {
    if (r.cardKey !== undefined) {
      const card = cardByKey.get(r.cardKey) ?? { key: r.cardKey, users: [] };
      let h = cardHolderOf(card, r.day, members, agreements);
      let fell: { fell?: true } = {};
      if (h.rule === 1) {
        const w = agreementWeights(agreementOn(perRow, r.cardKey, r.day, true), users, incomes, monthOfDay(r.day));
        if (!w.gone) return { t: "split", w, inC: false, key: r.cardKey };
        // the agreement names nobody left: the card's own use (rules 2 to 4), never the pool's
        h = cardHolderOf(card, r.day, members, []);
        fell = { fell: true };
      }
      if (h.rule === 2) return { t: "one", owner: h.owner, ...fell };
      if (h.rule === 3) return { t: "split", w: { weights: h.weights.map((u) => ({ owner: u.owner, weight: u.weight })), how: "card", incomeMissing: false, gone: false }, inC: true, key: r.cardKey, ...fell };
      return { t: "unknown" };
    }
    if (r.what === "one" && r.to !== undefined) return { t: "one", owner: r.to };
    const agreed = agreementOn(perRow, pool.key, r.day, true);
    // weights from the holder names are no split: a share or "paid more" would be a guess (owner rule L5)
    if (!agreed && pool.split === "unknown" && !fixedOf(agreements, pool.key, monthOfDay(r.day))) return { t: "unknown", untold: true };
    return split(agreed, r.day, true, pool.key);
  }

  /** The parts of a cost at its own day: what a later deposit paid is credit again, whatever the stored row says now. */
  const ownDay = (r: RowParts): Entry[] => {
    const parts = r.parts.filter((p) => p.owner !== "c").map((p) => ({ owner: p.owner, cents: p.cents }));
    for (const f of fillsOn.get(r.key) ?? []) {
      let left = f.cents;
      for (const p of parts) {
        const t = p.owner === f.owner ? Math.min(left, p.cents) : 0;
        p.cents -= t;
        left -= t;
      }
    }
    return merge([...parts, ...(r.onCredit ? [{ owner: "c", cents: r.onCredit }] : [])]);
  };

  /** What the rows of a month put on the paying side, before any answer is applied. */
  const rawOf = (month: string): Raw[] => {
    const out: Raw[] = [];
    for (const r of byMonth.get(month) ?? []) {
      if (isCost(r)) {
        if (treatOf(r).t !== "unknown") out.push({ kind: "cost", row: r, parts: ownDay(r) });
        continue;
      }
      if (r.cents <= 0) continue;
      const p = r.refundOf ? byKey.get(r.refundOf) : undefined;
      if (p && isCost(p) && treatOf(p).t !== "unknown") {
        const net = r.parts.filter((x: SourcePart) => NETTING.has(x.kind));
        if (net.length) out.push({ kind: "refund", row: r, of: p, parts: merge(net.map((x) => ({ owner: x.owner, cents: -x.cents }))) });
      }
      const paid = new Map<string, { of: RowParts; parts: Entry[] }>();
      for (const f of r.fills ?? []) {
        const cost = byKey.get(f.key);
        if (!cost || !isCost(cost) || treatOf(cost).t === "unknown") continue;
        const g = paid.get(f.key) ?? { of: cost, parts: [] };
        g.parts.push({ owner: f.owner, cents: f.cents }, { owner: "c", cents: -f.cents });
        paid.set(f.key, g);
      }
      for (const g of paid.values()) out.push({ kind: "credit_filled", row: r, of: g.of, parts: merge(g.parts) });
    }
    return out;
  };

  /** The entries of `entries` with the answers applied: an answer relabels the money of its group or of the opening, no other cent moves. */
  const relabeler = (answers: readonly Answer[]) => (entries: readonly Entry[]): Entry[] => {
    if (!answers.length) return merge(entries);
    const row = (sign: 1 | -1): RowParts => ({
      key: "",
      ids: [],
      day: 0,
      cents: 0,
      what: "all",
      parts: entries.filter((e) => Math.sign(e.cents) === sign).map((e) => ({ owner: e.owner, kind: "own", cents: Math.abs(e.cents) })),
    });
    const t = settle({ rows: [row(1), row(-1)], lots: [], before: [], groups: [], openingCents: 0, openingDay: 0, openingTaken: false, creditCents: 0 }, answers, pool.users);
    return merge(t.rows.flatMap((r, i) => r.parts.map((p) => ({ owner: p.owner, cents: i === 0 ? p.cents : -p.cents }))));
  };
  const relabelAt = (day: number) =>
    relabeler(
      pool.answers.filter((a) => dayNumber(a.saidOn) <= day),
    );

  /** Cents of a cost's credit still uncovered on `day`: fills and refunds that cancelled credit up to then are taken off. */
  const creditLeft = (r: RowParts, day: number): number => {
    const own = r.onCredit ?? 0;
    const paid = [...(fillsOn.get(r.key) ?? []), ...(cancels.get(r.key) ?? [])].filter((x) => x.day <= day).reduce((s, x) => s + x.cents, 0);
    return Math.max(0, own - paid);
  };
  /** Whether anything of a month is still unknown on `day`: credit not covered, an owner nobody has named, a bill of an unknown holder, a refund pending. */
  const unresolved = (month: string, day: number): boolean => {
    const costs = (byMonth.get(month) ?? []).filter(isCost);
    if (costs.some((r) => treatOf(r).t === "unknown" || pendingFor.has(r.key))) return true;
    const relabel = relabelAt(day);
    return costs.some((r) => creditLeft(r, day) > 0 || relabel(ownDay(r).filter((e) => e.owner !== "c")).some((e) => e.cents > 0 && !members.has(e.owner)));
  };

  const closings = new Map<string, number | null>();
  /** The day a month closed, or null while it is open: when nothing is unknown any more (never before its last day, and only once today is past it), or CLOSE_DAYS after it. */
  const closedOn = (month: string): number | null => {
    if (closings.has(month)) return closings.get(month)!;
    const end = monthLast(month);
    const limit = end + CLOSE_DAYS;
    let day: number | null = null;
    if (asOfDay > end) {
      const days = [...new Set([end, ...[...eventDays].filter((d) => d > end && d <= Math.min(limit, asOfDay))])].sort((a, b) => a - b);
      day = days.find((d) => !unresolved(month, d)) ?? (asOfDay >= limit ? limit : null);
    }
    closings.set(month, day);
    return day;
  };

  return { users, members, incomes, agreements, perRow, pool, asOfDay, months, byMonth, treatOf, rawOf, relabeler, relabelAt, closedOn };
}

