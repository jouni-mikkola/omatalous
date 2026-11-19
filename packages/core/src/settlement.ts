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
import { compareOwners, type Owner, type RowParts } from "./money-trace.ts";
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
  /** `late_change`: what it moved by the line key it compared (a row, or the month of `fixed`), so a later one takes off only the rows it reads again. Absent on a line written before rows were recorded. */
  byRow?: { key: string; paid: Entry[]; owed: Entry[] }[];
  /** `late_change`: what it took off of earlier lines with no `byRow`, which a later one adds back before it takes them off again. */
  undid?: { paid: Entry[]; owed: Entry[] };
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
  /** Costs of a pool whose split nobody has told, with no agreement on their day: left out of paid and owed alike, so no share and no "paid more" is a guess. Left out when there is none, and in a month closed before 0.66. */
  untold?: { key: string; day: number; cents: number }[];
  /** The agreement rows the month used. */
  agreements: { accountKey: string; validFrom: string }[];
  incomeMissing: boolean;
  /** An agreement named nobody who is left: the use as said now stood in. */
  fellBack: boolean;
}

const RANK = { cost: 0, refund: 1, credit_filled: 2, answered: 3, late_change: 4, fixed: 5 } as const;
const total = (entries: readonly { cents: number }[]): number => entries.reduce((s, e) => s + e.cents, 0);
/** The one line that stands for unknown sources of both signs set against each other: no source is named, none is guessed. */
export const NETTED_SOURCE: Owner = "n";
/**
 * The unknown sources of one side. Credit that a later deposit covered, or money an answer took from its group, is a
 * negative entry beside a positive one, and which source the deposit refilled is not known. When every source has the
 * sign of the total they stay as they are; when the signs are mixed, the month's figure is one line with no source.
 * The sum is the same either way, and a netted list nets to itself.
 */
function netSources(entries: Entry[]): Entry[] {
  const cents = total(entries);
  if (entries.every((e) => Math.sign(e.cents) === Math.sign(cents))) return entries;
  return cents === 0 ? [] : [{ owner: NETTED_SOURCE, cents }];
}
/** A stored month with its unknown sources netted as `settlement` nets a month it works out: the object itself when nothing changes. */
export function nettedMonth(c: ClosedMonth): ClosedMonth {
  const unknownPaidBy = netSources(c.unknownPaidBy);
  const unknownOwedBy = netSources(c.unknownOwedBy);
  return unknownPaidBy === c.unknownPaidBy && unknownOwedBy === c.unknownOwedBy ? c : { ...c, unknownPaidBy, unknownOwedBy };
}
/** A cost left out of the month: of a card whose holder is not known, or (`untold`) of a pool nobody has split. */
const isUnknown = (t: { t: string; untold?: true }, untold: boolean): boolean => t.t === "unknown" && !!t.untold === untold;

function compute(month: string, pool: SettlementPool, agreements: readonly AgreementRow[], members: ReadonlySet<Owner>, cards: readonly CardUse[], incomes: Incomes, asOf: string, frozen: ReadonlySet<string>, late: readonly SettlementLine[], current: boolean): Settlement {
  const asOfDay = dayNumber(asOf);
  const book = makeBook(pool, agreements, members, cards, incomes, asOfDay);
  const closed = book.closedOn(month);
  const relabel = book.relabelAt(current ? asOfDay : (closed ?? asOfDay), closed);
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

  // an answer said in this month that gives a closed month's unknown money to its owner: it lands here. Money an answer
  // in force at the close gave an owner (the opening's default) was not unknown, and the month keeps it.
  for (const a of pool.answers) {
    const s = dayNumber(a.saidOn);
    if (s > asOfDay || monthOfDay(s) !== month) continue;
    const apply = book.relabeler([a]);
    for (const m of book.months) {
      if (m >= month) break;
      const end = book.closedOn(m);
      if (end === null || end >= s || frozen.has(m) || book.answeredBy(a.key, end)) continue;
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
  const unknownPaidBy = netSources(unknown(paidAll));
  const unknownOwedBy = netSources(unknown(owedAll));
  const untold = (book.byMonth.get(month) ?? []).filter((r) => r.cents < 0 && !r.pending && (r.what === "all" || r.what === "one") && isUnknown(book.treatOf(r), true)).map((r) => ({ key: r.key, day: r.day, cents: -r.cents }));
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
    unknownHolder: (book.byMonth.get(month) ?? []).filter((r) => r.cents < 0 && !r.pending && (r.what === "all" || r.what === "one") && isUnknown(book.treatOf(r), false)).map((r) => ({ key: r.key, day: r.day, cents: -r.cents, ...(r.cardKey !== undefined ? { cardKey: r.cardKey } : {}) })),
    ...(untold.length ? { untold } : {}),
    agreements: [...used.values()].sort((a, b) => (a.accountKey < b.accountKey ? -1 : a.accountKey > b.accountKey ? 1 : a.validFrom < b.validFrom ? -1 : 1)),
    incomeMissing,
    fellBack,
  };
}

/** A closed month as it was when it closed: the month's own output, frozen. Answers and the use are stored as the latest only, so it is never recomputed. */
export type ClosedMonth = Settlement & { status: { open: false; closedOn: string; by: "resolved" | "time" } };

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

/** A word a member said that reads a closed month anew: an answer by the group (or the opening) it names, a use, a split or an agreement by the account it is of. */
interface SaidWord {
  on: number;
  account?: string;
  group?: string;
}

const readsRow = (w: SaidWord, r: RowParts, poolKey: string): boolean =>
  w.account === poolKey || (w.account !== undefined && r.cardKey === w.account) || (w.group !== undefined && (r.parts.some((p) => p.owner === w.group) || !!r.fills?.some((f) => f.owner === w.group)));

/**
 * The lines of a closed month that its comparison with today takes (ADR 0017): those of the rows a word said on or after
 * the closing day reads anew, and those of rows the month never held (booked after it was stored). An answer reads the
 * rows that paid from its group or the opening; a use, a split or an agreement of the pool in force by the month's end
 * reads every row, and one of a card the card's bills. A rule, a category or the holder names is no word of the
 * household, and a cost whose split is untold today says nothing new. A cost counted in a fixed amount is taken with the
 * month's fixed line and every other such cost. `keeps`: whether an earlier correction that records no rows is taken off,
 * which only a word said by its day can have made or a row the month never held can be in already. Null when nothing
 * is taken: the month and the corrections later snapshots took in for it stand as they are.
 */
function comparedLines(c: ClosedMonth, now: Settlement, pool: SettlementPool, agreements: readonly AgreementRow[], rowOf: ReadonlyMap<string, RowParts>, untoldToday: (key: string | undefined) => boolean) {
  const since = dayNumber(c.status.closedOn);
  const end = fromDayNumber(monthLast(c.month));
  const rows = [...new Set([...now.lines, ...c.lines].flatMap((l) => [l.key, l.of]))].flatMap((k) => (k === undefined ? [] : (rowOf.get(k) ?? [])));
  const words: SaidWord[] = [
    ...[...(pool.usesSaidOn ?? [])].map(([account, on]) => ({ on: dayNumber(on), account })),
    ...agreements.flatMap((a) => (a.setOn !== undefined && a.validFrom <= end ? [{ on: dayNumber(a.setOn), account: a.accountKey }] : [])),
    ...pool.answers.map((a) => ({ on: dayNumber(a.saidOn), group: a.key })),
  ].filter((w) => w.on >= since && rows.some((r) => readsRow(w, r, pool.key)));
  const held = new Set([...c.lines.map((l) => l.key), ...(c.untold ?? []).map((u) => u.key), ...c.unknownHolder.map((u) => u.key)]);
  const fresh = (l: SettlementLine): boolean => (l.kind === "cost" || l.kind === "refund" || l.kind === "credit_filled") && !held.has(l.key);
  const anyFresh = now.lines.some(fresh);
  const reads = (key: string | undefined): boolean => {
    const r = key === undefined ? undefined : rowOf.get(key);
    return !!r && words.some((w) => readsRow(w, r, pool.key));
  };
  const anew = (l: SettlementLine): boolean => l.kind !== "late_change" && !untoldToday(l.key) && !untoldToday(l.of) && (fresh(l) || reads(l.key) || reads(l.of));
  // a cost counted in the month's fixed amount owes nothing of its own: the fixed line owes it. So the fixed line and every
  // such row, in either reading, are taken together or not at all, and the correction owes what it pays.
  const inFixed = new Set([...now.lines, ...c.lines].filter((l) => (l.kind === "cost" || l.kind === "refund") && !l.owed.length).map((l) => l.key));
  const fixedAnew = [...now.lines, ...c.lines].some((l) => inFixed.has(l.key) && anew(l));
  const take = (l: SettlementLine): boolean => (l.kind === "fixed" || inFixed.has(l.key) ? fixedAnew : anew(l));
  if (![...now.lines, ...c.lines].some(take)) return null;
  return { take, keeps: (t: SettlementLine): boolean => anyFresh || words.some((w) => w.on <= t.day) };
}

/**
 * The `late_change` line of closed month `c` read today (`now`) on the lines `take` takes, less what the corrections later
 * snapshots took in for it (`taken`) moved on those lines. A correction from before rows were recorded is taken off whole
 * when `keeps` says so; what one took off so is added back first, so each is taken off once.
 */
function lateLine(c: ClosedMonth, now: Settlement, taken: readonly SettlementLine[], take: (l: SettlementLine) => boolean, keeps: (l: SettlementLine) => boolean, day: number): SettlementLine | null {
  type Side = "paid" | "owed";
  const lines = (from: Settlement, key: string) => from.lines.filter((l) => l.key === key && take(l));
  const keys = [...new Set([...now.lines, ...c.lines].filter(take).map((l) => l.key))];
  const rowSide = (key: string, side: Side): Entry[] =>
    merge([...lines(now, key).flatMap((l) => l[side]), ...negate(lines(c, key).flatMap((l) => l[side])), ...negate(taken.flatMap((t) => (t.byRow ?? []).filter((r) => r.key === key).flatMap((r) => r[side])))]);
  const byRow = keys.map((key) => ({ key, paid: rowSide(key, "paid"), owed: rowSide(key, "owed") })).filter((r) => r.paid.length || r.owed.length);
  const undidSide = (side: Side): Entry[] => merge([...negate(taken.filter((t) => !t.byRow && keeps(t)).flatMap((t) => t[side])), ...negate(taken.flatMap((t) => t.undid?.[side] ?? []))]);
  const undid = { paid: undidSide("paid"), owed: undidSide("owed") };
  const paid = merge([...byRow.flatMap((r) => r.paid), ...undid.paid]);
  const owed = merge([...byRow.flatMap((r) => r.owed), ...undid.owed]);
  if (!paid.length && !owed.length) return null;
  return { kind: "late_change", key: c.month, day, cents: total(paid), paid, owed, byRow, ...(undid.paid.length || undid.owed.length ? { undid } : {}) };
}

/**
 * `agreements` are the rows of `account_agreement` (the pool's and the cards'), `members` the household members who use
 * the pool, `cards` the card accounts, `incomes` the earned income by member and month, `asOf` today (`YYYY-MM-DD`).
 * `closed` holds the snapshots of the pool's closed months: such a month is returned as it is. What a member said of it
 * after it closed (a later answer, use, split or agreement) and the rows it never held land as one `late_change` line
 * per closed month in the first month after it that has no snapshot, less what a later snapshot has taken in already.
 * Snapshot months in order, oldest first. A closed month is final: only the lines `comparedLines` takes are compared,
 * so a change of rules, or a cost whose split is not told today, leaves it as the snapshot settled it (ADR 0017).
 */
export function settlement(month: string, pool: SettlementPool, agreements: readonly AgreementRow[], household: ReadonlySet<Owner>, cards: readonly CardUse[], incomes: Incomes, asOf: string, closedAsStored: readonly ClosedMonth[] = []): Settlement {
  const closed = closedAsStored.map(nettedMonth);
  const members = holderKnown(pool, agreements) ? new Set([...household, "u:"]) : household;
  const snapshot = closed.find((c) => c.month === month);
  if (snapshot) return snapshot;
  const frozen = new Set(closed.map((c) => c.month));
  const rowOf = new Map(pool.trace.rows.map((r) => [r.key, r]));
  let book: ReturnType<typeof makeBook> | undefined;
  // a cost of any month, also one before the first snapshot that a refund or a deposit names in `of`
  const untoldToday = (key: string | undefined): boolean => {
    const r = key === undefined || pool.split !== "unknown" ? undefined : rowOf.get(key);
    if (!r || r.cents >= 0 || r.pending || (r.what !== "all" && r.what !== "one")) return false;
    book ??= makeBook(pool, agreements, members, cards, incomes, dayNumber(asOf));
    return isUnknown(book.treatOf(r), true);
  };
  const late: SettlementLine[] = [];
  const nowOf = new Map<string, Settlement>();
  const worked = (m: string): Settlement => {
    let s = nowOf.get(m);
    if (!s) nowOf.set(m, (s = compute(m, pool, agreements, members, cards, incomes, asOf, frozen, [], true)));
    return s;
  };
  for (const c of closed) {
    let first = addMonths(c.month, 1);
    while (frozen.has(first)) first = addMonths(first, 1);
    if (first !== month) continue;
    const now = worked(c.month);
    const by = comparedLines(c, now, pool, agreements, rowOf, untoldToday);
    if (!by) continue;
    const taken = closed.flatMap((x) => x.lines.filter((l) => l.kind === "late_change" && l.key === c.month));
    const line = lateLine(c, now, taken, by.take, by.keeps, dayNumber(asOf));
    if (line) late.push(line);
  }
  return compute(month, pool, agreements, members, cards, incomes, asOf, frozen, late, false);
}

export interface Transfer {
  from: string;
  to: string;
  cents: number;
}

/** The sums of a pool's month the settlement block shows, so the page adds up no money of its own. */
interface SettlementSums {
  /** Who pays whom to settle the month (`transfersOf`) and what they add up to. */
  transfers: Transfer[];
  owedCents: number;
  /** The costs of a pool whose split nobody has told (`untold`): 0 when the split is known. */
  untoldCents: number;
  /** The bills of a card whose holder is not known (`unknownHolder`). */
  heldBackCents: number;
  /** What the members who paid over are owed in all, and what those who paid under owe in all. */
  creditCents: number;
  debtCents: number;
  /** The part of the larger of the two that no member's figure pairs with: money nobody has told the owner of. */
  openCents: number;
}

export function settlementSums(s: Pick<Settlement, "members" | "unknownHolder" | "untold">): SettlementSums {
  const transfers = transfersOf(s.members);
  const creditCents = s.members.reduce((sum, m) => sum + Math.max(m.over, 0), 0);
  const debtCents = s.members.reduce((sum, m) => sum + Math.max(-m.over, 0), 0);
  return {
    transfers,
    owedCents: total(transfers),
    untoldCents: total(s.untold ?? []),
    heldBackCents: total(s.unknownHolder),
    creditCents,
    debtCents,
    openCents: Math.abs(creditCents - debtCents),
  };
}

/**
 * Who pays whom to settle the month: the ones who paid under their share pay the ones who paid over, the largest
 * debtor to the largest creditor first. The transfers add up to the smaller of the sum of the credits and the sum of the debts; the two
 * differ by what is unknown (core: `sum(over) = unknownOwed - unknownPaid`), and the page names that difference.
 */
export function transfersOf(members: readonly { owner: string; over: number }[]): Transfer[] {
  const debtors = members.filter((m) => m.over < 0).map((m) => ({ owner: m.owner, left: -m.over })).sort((a, b) => b.left - a.left || (a.owner < b.owner ? -1 : 1));
  const creditors = members.filter((m) => m.over > 0).map((m) => ({ owner: m.owner, left: m.over })).sort((a, b) => b.left - a.left || (a.owner < b.owner ? -1 : 1));
  const out: Transfer[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const from = debtors[d]!;
    const to = creditors[c]!;
    const cents = Math.min(from.left, to.left);
    if (cents > 0) out.push({ from: from.owner, to: to.owner, cents });
    from.left -= cents;
    to.left -= cents;
    if (from.left === 0) d++;
    if (to.left === 0) c++;
  }
  return out;
}
