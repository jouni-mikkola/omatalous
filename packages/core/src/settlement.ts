/**
 * The settlement between the partners of a joint account (a pool) for one month: how much more than their share each
 * paid. Costs are the pool's money out booked in the month; each is paid by the owners of its parts AT ITS OWN DAY and
 * owed by the agreement valid on its day (a card bill by its holder, see `cardHolderOf`). A refund nets in the month it
 * arrives, owed as the purchase was. Credit that a later deposit paid, and answers said after a month closed, land in
 * the month they happen: a closed month is never rewritten. The identity of every month is
 * `sum(over) = unknownOwed - unknownPaid`. Reads what is passed in; writes nothing; whole cents, and only `cut` rounds.
 */
import type { CardUse } from "./card-holder.ts";
import { addMonths, dayNumber, fromDayNumber } from "./dates.ts";
import { compareOwners, type Owner } from "./money-trace.ts";
import { type AgreementRow, cutShares, fixedOf, fixedOwed, type Incomes, restWeights, type Weighted } from "./settlement-agreements.ts";
import { CLOSE_DAYS, type Entry, makeBook, merge, monthLast, monthOfDay, type SaidAnswer, type SettlementPool } from "./settlement-ledger.ts";

export type { SaidAnswer, SettlementPool };

export interface SettlementLine {
  /** `cost` a row's cost; `refund` a refund netting a cost; `credit_filled` a deposit that paid an earlier cost's credit; `answered` an answer said after the cost's month closed; `late_change` what a closed month with a snapshot would read differently today (key: that month); `fixed` the month's one owed line. */
  kind: "cost" | "refund" | "credit_filled" | "answered" | "late_change" | "fixed";
  /** The trace row: the cost, the refund, the deposit; for `fixed` the month. */
  key: string;
  /** The cost a refund nets, a deposit paid or an answer gave an owner to. */
  of?: string;
  day: number;
  /** The row's cost, negative for a refund; `fixed`: the month's net cost. */
  cents: number;
  /** Signed cents by owner, the unknown owners (`g:`, `o`, `c`, `u:`) included. */
  paid: Entry[];
  owed: Entry[];
  how?: Weighted["how"] | "one" | "fixed";
  fixed?: { fsum: number; c: number; r: number };
}

export interface Settlement {
  month: string;
  status: { open: boolean; closedOn?: string; by?: "resolved" | "time" };
  members: { owner: Owner; paid: number; owed: number; over: number }[];
  unknownPaid: number;
  unknownOwed: number;
  unknownPaidBy: Entry[];
  unknownOwedBy: Entry[];
  /** What the month's costs came to, refunds netted: paid by members and unknown owners alike. */
  netCost: number;
  lines: SettlementLine[];
  /** Bills of a card whose holder is not known: left out of paid and owed alike. */
  unknownHolder: { key: string; day: number; cents: number; cardKey?: string }[];
  /** The agreement rows the month used. */
  agreements: { accountKey: string; validFrom: string }[];
  incomeMissing: boolean;
  /** An agreement named nobody who is left: the use as said now stood in. */
  fellBack: boolean;
}

const RANK = { cost: 0, refund: 1, credit_filled: 2, answered: 3, late_change: 4, fixed: 5 } as const;
const total = (entries: readonly Entry[]): number => entries.reduce((s, e) => s + e.cents, 0);

function compute(month: string, pool: SettlementPool, agreements: readonly AgreementRow[], members: ReadonlySet<Owner>, cards: readonly CardUse[], incomes: Incomes, asOf: string, frozen: ReadonlySet<string>, late: readonly SettlementLine[], current: boolean): Settlement {
  const asOfDay = dayNumber(asOf);
  const book = makeBook(pool, agreements, members, cards, incomes, asOfDay);
  const closed = book.closedOn(month);
  const relabel = book.relabelAt(current ? asOfDay : (closed ?? asOfDay));
  const fixedA = fixedOf(agreements, pool.key, month);
  const everyone = book.users.map((u) => u.owner).sort(compareOwners);
  const lines: SettlementLine[] = [];
  const used = new Map<string, { accountKey: string; validFrom: string }>();
  let incomeMissing = false;
  let fellBack = false;
  let c = 0;
  const note = (w: Weighted, accountKey: string): void => {
    if (w.from) used.set(`${accountKey}|${w.from}`, { accountKey, validFrom: w.from });
    incomeMissing ||= w.incomeMissing;
    fellBack ||= w.gone;
  };

  for (const raw of book.rawOf(month)) {
    const paid = relabel(raw.parts);
    if (raw.kind === "credit_filled") {
      lines.push({ kind: "credit_filled", key: raw.row.key, of: raw.of!.key, day: raw.row.day, cents: 0, paid, owed: [] });
      continue;
    }
    const cost = raw.kind === "cost" ? -raw.row.cents : total(raw.parts);
    const shared = book.treatOf(raw.of ?? raw.row);
    fellBack ||= !!shared.fell;
    let owed: Entry[] = [];
    let how: SettlementLine["how"];
    if (shared.t === "one") {
      owed = [{ owner: shared.owner, cents: cost }];
      how = "one";
    } else if (shared.t === "split") {
      how = shared.w.how;
      if (shared.inC && fixedA) c += cost;
      else {
        let w = shared.w;
        let from = shared.key;
        const month0 = raw.of ? monthOfDay(raw.of.day) : month;
        const was = raw.of && shared.inC ? fixedOf(agreements, pool.key, month0) : undefined;
        if (was) {
          // a refund arriving in a per-row month, of a purchase from a fixed month: cut by that agreement's `rest`
          const r = restWeights(was.value.rest, everyone, incomes, month0);
          w = { weights: r.weights, how: "equal", incomeMissing: r.incomeMissing, gone: false, from: was.validFrom };
          from = pool.key;
          how = "fixed";
        }
        note(w, from);
        owed = cutShares(cost, w.weights);
      }
    }
    lines.push({ kind: raw.kind, key: raw.row.key, ...(raw.of ? { of: raw.of.key } : {}), day: raw.row.day, cents: cost, paid, owed, ...(how ? { how } : {}) });
  }
  if (fixedA && c !== 0) {
    const f = fixedOwed(fixedA, book.users, incomes, month, c);
    incomeMissing ||= f.incomeMissing;
    used.set(`${pool.key}|${fixedA.validFrom}`, { accountKey: pool.key, validFrom: fixedA.validFrom });
    lines.push({ kind: "fixed", key: month, day: monthLast(month), cents: c, paid: [], owed: f.owed, how: "fixed", fixed: { fsum: f.fsum, c: f.c, r: f.r } });
  } else if (fixedA) used.set(`${pool.key}|${fixedA.validFrom}`, { accountKey: pool.key, validFrom: fixedA.validFrom });

  // an answer said in this month that gives a closed month's unknown money to its owner: it lands here
  for (const a of pool.answers) {
    const s = dayNumber(a.saidOn);
    if (s > asOfDay || monthOfDay(s) !== month) continue;
    const apply = book.relabeler([a]);
    for (const m of book.months) {
      if (m >= month) break;
      const end = book.closedOn(m);
      if (end === null || end >= s || frozen.has(m)) continue;
      for (const raw of book.rawOf(m)) {
        const mine = raw.parts.filter((e) => e.owner === a.key);
        const to = apply(mine);
        if (!mine.length || to.every((e) => e.owner === a.key)) continue;
        lines.push({ kind: "answered", key: raw.row.key, ...(raw.of ? { of: raw.of.key } : {}), day: s, cents: 0, paid: merge([...to, { owner: a.key, cents: -total(mine) }]), owed: [] });
      }
    }
  }
  lines.push(...late);
  lines.sort((a, b) => a.day - b.day || RANK[a.kind] - RANK[b.kind] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const sum = (pick: (l: SettlementLine) => Entry[]): Entry[] => merge(lines.flatMap(pick));
  const paidAll = sum((l) => l.paid);
  const owedAll = sum((l) => l.owed);
  const of = (list: Entry[], owner: Owner): number => list.find((e) => e.owner === owner)?.cents ?? 0;
  const owners = [...new Set([...book.users.map((u) => u.owner), ...paidAll.map((e) => e.owner), ...owedAll.map((e) => e.owner)])].filter((o) => members.has(o)).sort(compareOwners);
  const unknown = (list: Entry[]): Entry[] => list.filter((e) => !members.has(e.owner));
  const unknownPaidBy = unknown(paidAll);
  const unknownOwedBy = unknown(owedAll);
  return {
    month,
    status: closed === null ? { open: true } : { open: false, closedOn: fromDayNumber(closed), by: closed >= monthLast(month) + CLOSE_DAYS ? "time" : "resolved" },
    members: owners.map((owner) => ({ owner, paid: of(paidAll, owner), owed: of(owedAll, owner), over: of(paidAll, owner) - of(owedAll, owner) })),
    unknownPaid: total(unknownPaidBy),
    unknownOwed: total(unknownOwedBy),
    unknownPaidBy,
    unknownOwedBy,
    netCost: lines.filter((l) => l.kind === "cost" || l.kind === "refund" || l.kind === "late_change").reduce((s, l) => s + l.cents, 0),
    lines,
    unknownHolder: (book.byMonth.get(month) ?? []).filter((r) => r.cents < 0 && !r.pending && (r.what === "all" || r.what === "one") && book.treatOf(r).t === "unknown").map((r) => ({ key: r.key, day: r.day, cents: -r.cents, ...(r.cardKey !== undefined ? { cardKey: r.cardKey } : {}) })),
    agreements: [...used.values()].sort((a, b) => (a.accountKey < b.accountKey ? -1 : a.accountKey > b.accountKey ? 1 : a.validFrom < b.validFrom ? -1 : 1)),
    incomeMissing,
    fellBack,
  };
}

/** A closed month as it was when it closed: the month's own output, frozen. Answers and the use are stored as the latest only, so it is never recomputed. */
export type ClosedMonth = Settlement & { status: { open: false; closedOn: string; by: "resolved" | "time" } };

const entriesOf = (s: Settlement, side: "paid" | "owed"): Entry[] => merge([...s.members.map((m) => ({ owner: m.owner, cents: m[side] })), ...(side === "paid" ? s.unknownPaidBy : s.unknownOwedBy)]);
const negate = (entries: readonly Entry[]): Entry[] => entries.map((e) => ({ owner: e.owner, cents: -e.cents }));

/**
 * Whether the share of the holder nobody names (`u:`) is known: the account has two holders and they split equally, by
 * the use as said now and by every agreement of the pool. Then the holder is a party like a member, with a paid and an owed;
 * with any other split the holder's share cannot be told from the rest and stays unknown.
 */
function holderKnown(pool: SettlementPool, agreements: readonly AgreementRow[]): boolean {
  const users = pool.users.filter((u) => u.weight > 0);
  return users.length === 2 && users[0]!.weight === users[1]!.weight && users.some((u) => u.owner === "u:") && agreements.every((a) => a.accountKey !== pool.key || a.kind === "equal");
}

/**
 * `agreements` are the rows of `account_agreement` (the pool's and the cards'), `members` the household members who use
 * the pool, `cards` the card accounts, `incomes` the earned income by member and month, `asOf` today (`YYYY-MM-DD`).
 * `closed` holds the snapshots of the pool's closed months: such a month is returned as it is. What it would read
 * differently today (a later answer, a member gone) lands as one `late_change` line per closed month in the first month
 * after it that has no snapshot, less what a later snapshot has taken in already. Snapshot months in order, oldest first.
 */
export function settlement(month: string, pool: SettlementPool, agreements: readonly AgreementRow[], household: ReadonlySet<Owner>, cards: readonly CardUse[], incomes: Incomes, asOf: string, closed: readonly ClosedMonth[] = []): Settlement {
  const members = holderKnown(pool, agreements) ? new Set([...household, "u:"]) : household;
  const snapshot = closed.find((c) => c.month === month);
  if (snapshot) return snapshot;
  const frozen = new Set(closed.map((c) => c.month));
  const late: SettlementLine[] = [];
  for (const c of closed) {
    let first = addMonths(c.month, 1);
    while (frozen.has(first)) first = addMonths(first, 1);
    if (first !== month) continue;
    const now = compute(c.month, pool, agreements, members, cards, incomes, asOf, frozen, [], true);
    const taken = closed.flatMap((x) => x.lines.filter((l) => l.kind === "late_change" && l.key === c.month));
    const diff = (side: "paid" | "owed"): Entry[] => merge([...entriesOf(now, side), ...negate(entriesOf(c, side)), ...c.lines.filter((l) => l.kind === "late_change").flatMap((l) => l[side]), ...negate(taken.flatMap((l) => l[side]))]);
    const paid = diff("paid");
    const owed = diff("owed");
    if (paid.length || owed.length) late.push({ kind: "late_change", key: c.month, day: dayNumber(asOf), cents: total(paid), paid, owed });
  }
  return compute(month, pool, agreements, members, cards, incomes, asOf, frozen, late, false);
}
