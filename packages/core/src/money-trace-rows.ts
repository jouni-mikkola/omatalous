/**
 * The rows of one real account for the money trace: the copies each member holds are joined into one list, and every
 * row is read for what it is (a person's own money, a payment by one person, a movement between pools, a refund,
 * money back, or unknown money) from the payers the caller gives. Nothing here reads a database or a clock.
 */
import { dayNumber } from "./dates.ts";
import { fold } from "./merchant.ts";
import type { Owner, SourcePart, TraceRow } from "./money-trace.ts";
import { PAIR_DAYS } from "./money-trace.ts";
import { type Name, nameOf, samePerson } from "./person-names.ts";
import { matchReturns } from "./returns.ts";
import { normalizeIban, pairable, pairTransfers } from "./transfers.ts";
import type { Account, Transaction } from "./types.ts";

/** One row of the real account, once: its key, its id on each copy that holds it, and the copy's row it was read from. */
interface JoinedRow {
  key: string;
  ids: readonly string[];
  tx: Transaction;
  /** A row of a copy that was not traced and has no match in the one that was: unknown whole. */
  unmatched?: true;
}
export interface Joined {
  /** The copy whose account stands for the real account in the lists below. */
  accountId: string;
  rows: JoinedRow[];
  /** Whether the copies disagreed over the days they both cover, and the newest was traced alone. */
  tripped: boolean;
}

/** Who pays, household-wide, by IBAN (normalised) and name. */
export interface Payers {
  /** Every account of the household, the copies of this pool included. */
  accounts: readonly Account[];
  /** The rows of the household's other accounts: where the other leg of a movement is found. */
  others: readonly Transaction[];
  /** The accounts one person uses alone: IBAN to that person. */
  alone: ReadonlyMap<string, Owner>;
  /** The card accounts one person uses alone: account id to that person. A card account has no IBAN, so it is keyed by the account. */
  aloneAccount?: ReadonlyMap<string, Owner>;
  /** The IBANs of the pools. */
  pools: ReadonlySet<string>;
  /** Every user's name. */
  names: readonly { owner: Owner; name: Name }[];
  /** The parts the money-out leg took in the pool it left; undefined where that pool is not traced before this one. */
  legParts?: (leg: Transaction) => readonly SourcePart[] | undefined;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const pad = (n: number): string => String(n).padStart(5, "0");

/** What two copies of one row share besides the day and the sum. */
const contentOf = (t: Transaction): string => `${fold(t.counterparty ?? "")}|${fold(t.description ?? "")}|${t.reference ?? ""}`;

interface Keyed {
  key: string;
  day: number;
  tx: Transaction;
}

/** The rows of one copy with their keys: day, sum, content and the place among the rows that share them (by stored id, which only tells equal rows apart). */
function keyed(rows: readonly Transaction[], pending: boolean): Keyed[] {
  const same = new Map<string, Transaction[]>();
  for (const tx of rows) {
    if ((tx.status === "pending") !== pending) continue;
    const base = `${dayNumber(tx.bookingDate)}|${tx.amountCents}|${contentOf(tx)}`;
    const list = same.get(base);
    if (list) list.push(tx);
    else same.set(base, [tx]);
  }
  const out: Keyed[] = [];
  for (const [base, list] of same) list.sort((a, b) => cmp(a.id, b.id)).forEach((tx, i) => out.push({ key: `${base}|${pending ? "p" : ""}${pad(i)}`, day: dayNumber(tx.bookingDate), tx }));
  return out;
}

/**
 * Joins the copies of one real account into one list. A row either copy has is in the list once and carries the id it
 * has on each copy. Over the days both of two copies cover the copies must hold the same rows; if they do not, the
 * copy with the newest booked row is traced alone and a row another copy has that it lacks is unknown whole.
 */
export function joinCopies(copies: readonly { accountId: string; rows: readonly Transaction[] }[]): Joined {
  const sorted = [...copies].sort((a, b) => cmp(a.accountId, b.accountId));
  const booked = sorted.map((c) => keyed(c.rows, false));
  const sets = booked.map((rows) => new Set(rows.map((r) => r.key)));
  const span = booked.map((rows) => ({ first: Math.min(...rows.map((r) => r.day)), last: Math.max(...rows.map((r) => r.day)), count: rows.length }));

  let tripped = false;
  for (let i = 0; i < sorted.length && !tripped; i++) {
    for (let j = i + 1; j < sorted.length && !tripped; j++) {
      const from = Math.max(span[i]!.first, span[j]!.first);
      const to = Math.min(span[i]!.last, span[j]!.last);
      if (from > to) continue;
      const lacks = (rows: Keyed[], other: Set<string>) => rows.some((r) => r.day >= from && r.day <= to && !other.has(r.key));
      tripped = lacks(booked[i]!, sets[j]!) || lacks(booked[j]!, sets[i]!);
    }
  }

  // the copy traced alone: the newest booked row, then the more rows, then the lower account id
  let alone = 0;
  sorted.forEach((_, i) => {
    const a = span[i]!;
    const b = span[alone]!;
    if (a.last > b.last || (a.last === b.last && a.count > b.count)) alone = i;
  });

  const rows = new Map<string, Omit<JoinedRow, "ids"> & { ids: string[] }>();
  const put = (r: Keyed, unmatched: boolean): void => {
    const have = rows.get(r.key);
    if (have) have.ids.push(r.tx.id);
    else rows.set(r.key, { key: r.key, ids: [r.tx.id], tx: r.tx, ...(unmatched ? { unmatched: true as const } : {}) });
  };
  if (tripped) {
    // the traced copy first, so a row of the others that has a match joins its row
    for (const r of booked[alone]!) put(r, false);
    for (const r of keyed(sorted[alone]!.rows, true)) put(r, false);
    sorted.forEach((_, i) => {
      if (i !== alone) for (const r of booked[i]!) put(r, !sets[alone]!.has(r.key));
    });
  } else {
    sorted.forEach((c, i) => {
      for (const r of booked[i]!) put(r, false);
      for (const r of keyed(c.rows, true)) put(r, false);
    });
  }
  const list = [...rows.values()].sort((a, b) => dayNumber(a.tx.bookingDate) - dayNumber(b.tx.bookingDate) || cmp(a.key, b.key));
  return { accountId: sorted[alone]?.accountId ?? "", rows: list, tripped };
}

/** The payer of unknown money: its IBAN, else its name, else what the row says. */
function groupOf(tx: Transaction): Owner {
  const iban = normalizeIban(tx.counterpartyIban);
  if (iban) return `g:iban:${iban}`;
  return `g:text:${fold((tx.counterparty ?? "").trim()) || fold((tx.description ?? "").trim())}`;
}

/** The one user whose name this is, and nobody else's. */
function userNamed(text: string | null, names: Payers["names"]): Owner | undefined {
  if (!text?.trim()) return undefined;
  const payer = nameOf(text);
  const hits = new Set(names.filter((n) => samePerson(n.name, payer)).map((n) => n.owner));
  return hits.size === 1 ? [...hits][0] : undefined;
}

const UNSEEN = "\u0000";

/**
 * What every row of the pool is, from the payers: whose money it is when that is plain,
 * the other leg of a movement between pools, the purchase a refund returns, money back, or unknown money. Rows
 * whose legs are on accounts nobody traces carry what the household said of the accounts, and nothing else.
 */
export function traceRows(joined: Joined, who: Payers): TraceRow[] {
  const ibanOf = new Map(who.accounts.map((a) => [a.id, normalizeIban(a.iban)]));
  const self = ibanOf.get(joined.accountId) ?? null;
  const others = who.others.filter((t) => t.status !== "pending" && t.accountId !== joined.accountId && (self === null || ibanOf.get(t.accountId) !== self));
  const otherById = new Map(others.map((t) => [t.id, t]));
  const ownIbans = new Set([...ibanOf.values()].filter((x): x is string => !!x));
  // only booked rows are paired, matched and counted for the first payment; a pending row is read by IBAN and name alone
  const readable = joined.rows.filter((r) => !r.unmatched);
  const booked = readable.filter((r) => r.tx.status !== "pending");

  // movements between own accounts: the leg on another account of every row that has one
  const mine = booked.map((r) => ({ ...r.tx, id: UNSEEN + r.key, accountId: joined.accountId }));
  const { pairs } = pairTransfers([...mine, ...others], who.accounts);
  const legOf = new Map<string, Transaction>();
  for (const [outId, inId] of pairs) {
    if (outId.startsWith(UNSEEN)) {
      const leg = otherById.get(inId);
      if (leg) legOf.set(outId.slice(1), leg);
    } else if (inId.startsWith(UNSEEN)) {
      const leg = otherById.get(outId);
      if (leg) legOf.set(inId.slice(1), leg);
    }
  }
  const aloneOf = (tx: Transaction, leg: Transaction | undefined): Owner | undefined => {
    const byIban = who.alone.get(normalizeIban(tx.counterpartyIban) ?? "");
    return byIban ?? (leg ? (who.alone.get(ibanOf.get(leg.accountId) ?? "") ?? who.aloneAccount?.get(leg.accountId)) : undefined);
  };

  // the legs on another pool: the same cents, the money out on the same day or up to PAIR_DAYS before the money in, and
  // evidence that the two rows are one movement: one names the other's pool by IBAN, or neither has an IBAN and both may be a transfer
  const onPool = (t: Transaction): boolean => {
    const iban = ibanOf.get(t.accountId);
    return !!iban && iban !== self && who.pools.has(iban);
  };
  const legIndex = new Map<number, Map<number, Transaction[]>>();
  for (const t of [...others].sort((a, b) => dayNumber(a.bookingDate) - dayNumber(b.bookingDate) || cmp(contentOf(a), contentOf(b)) || cmp(a.id, b.id))) {
    if (!onPool(t) || t.status === "pending") continue;
    let days = legIndex.get(t.amountCents);
    if (!days) legIndex.set(t.amountCents, (days = new Map()));
    const day = dayNumber(t.bookingDate);
    const list = days.get(day);
    if (list) list.push(t);
    else days.set(day, [t]);
  }
  const used = new Set<string>();
  const poolLeg = (tx: Transaction, dir: 1 | -1): Transaction | undefined => {
    const days = legIndex.get(-tx.amountCents);
    if (!days) return undefined;
    const day = dayNumber(tx.bookingDate);
    const rowIban = normalizeIban(tx.counterpartyIban);
    for (let gap = 0; gap <= PAIR_DAYS; gap++) {
      for (const leg of days.get(day + dir * gap) ?? []) {
        const legIban = normalizeIban(leg.counterpartyIban);
        if (used.has(leg.id) || (rowIban && rowIban !== ibanOf.get(leg.accountId)) || (legIban && legIban !== self)) continue;
        if (!rowIban && !legIban && !(pairable(tx) && pairable(leg))) continue;
        used.add(leg.id);
        return leg;
      }
    }
    return undefined;
  };

  // the first money out of every payee: money back is a payee the pool has paid before
  const firstPaid = new Map<string, number>();
  const paidTo = new Map<string, { key: string; day: number }[]>();
  for (const r of booked) {
    const name = fold((r.tx.counterparty ?? "").trim());
    if (r.tx.amountCents >= 0 || !name) continue;
    const day = dayNumber(r.tx.bookingDate);
    if (day < (firstPaid.get(name) ?? Infinity)) firstPaid.set(name, day);
    const list = paidTo.get(name);
    if (list) list.push({ key: r.key, day });
    else paidTo.set(name, [{ key: r.key, day }]);
  }

  type Source = TraceRow["from"];
  const classified = new Map<string, { from?: Source; group?: Owner }>();
  const outs = new Map<string, TraceRow["to"]>();
  // the order: an account one person uses alone, an IBAN that is another pool's (whatever name the row carries), a
  // user's name (read only where the IBAN is no account of the household), and last the other leg on another pool
  const fromPool = (pooled: Transaction | undefined, other: string | undefined): { from?: Source; group: Owner } => {
    const iban = (pooled ? ibanOf.get(pooled.accountId) : null) ?? other ?? "";
    const parts = pooled ? who.legParts?.(pooled) : undefined;
    const from = parts ? { parts: parts.filter((p) => p.cents > 0).map((p): SourcePart => ({ owner: p.owner.startsWith("u:") || p.owner.startsWith("g:") ? p.owner : `g:iban:${iban}`, kind: "pool", cents: p.cents })) } : undefined;
    return { ...(from ? { from } : {}), group: `g:iban:${iban}` };
  };
  for (const r of readable) {
    const tx = r.tx;
    const isBooked = tx.status !== "pending";
    const leg = isBooked ? legOf.get(r.key) : undefined;
    const rowIban = normalizeIban(tx.counterpartyIban);
    const owner = aloneOf(tx, leg);
    const poolIban = rowIban && rowIban !== self && who.pools.has(rowIban) ? rowIban : undefined;
    const named = rowIban && ownIbans.has(rowIban) ? undefined : userNamed(tx.counterparty, who.names);
    if (tx.amountCents < 0) {
      if (owner !== undefined) outs.set(r.key, { owner });
      else if (poolIban !== undefined) outs.set(r.key, "pool");
      else if (named !== undefined) outs.set(r.key, { owner: named });
      else if (isBooked && poolLeg(tx, 1)) outs.set(r.key, "pool");
      continue;
    }
    if (tx.amountCents === 0) continue;
    if (owner !== undefined) classified.set(r.key, { from: { owner, kind: "own" } });
    else if (poolIban !== undefined) classified.set(r.key, fromPool(isBooked ? poolLeg(tx, -1) : undefined, poolIban));
    else if (named !== undefined) classified.set(r.key, { from: { owner: named, kind: "payment" } });
    else {
      const pooled = isBooked ? poolLeg(tx, -1) : undefined;
      if (pooled) classified.set(r.key, fromPool(pooled, undefined));
    }
  }

  // a refund returns the purchase it is paired with; the rows read above are not offered again
  const returns = matchReturns(
    mine,
    ownIbans,
    new Set(booked.filter((r) => classified.has(r.key)).map((r) => UNSEEN + r.key)),
  );

  return joined.rows.map((r): TraceRow => {
    const tx = r.tx;
    const day = dayNumber(tx.bookingDate);
    const base = { key: r.key, ids: r.ids, day, cents: tx.amountCents, ...(tx.status === "pending" ? { pending: true as const } : {}) };
    if (r.unmatched) return { ...base, unmatched: true };
    if (tx.amountCents < 0) {
      const to = outs.get(r.key);
      return to ? { ...base, to } : base;
    }
    const seen = classified.get(r.key);
    const group = seen?.group ?? groupOf(tx);
    if (seen?.from) return { ...base, from: seen.from, group };
    if (seen) return { ...base, group };
    const purchase = returns.get(UNSEEN + r.key);
    if (purchase !== undefined) return { ...base, from: { refundOf: purchase.slice(1) }, group };
    const name = fold((tx.counterparty ?? "").trim());
    if (name && tx.status !== "pending" && (firstPaid.get(name) ?? Infinity) <= day) {
      // a payee the pool paid only in rows for one and the same person gives back what the latest of them took; rows for
      // different persons cannot say whose the money is, and it stays back by the mix
      const before = (paidTo.get(name) ?? []).filter((p) => p.day <= day);
      const latest = before.reduce<{ key: string; day: number } | undefined>((a, p) => (!a || p.day > a.day || (p.day === a.day && cmp(p.key, a.key) > 0) ? p : a), undefined);
      const forOne = (p: { key: string }) => {
        const to = outs.get(p.key);
        const first = outs.get(before[0]!.key);
        return typeof to === "object" && typeof first === "object" && to.owner === first.owner;
      };
      if (latest && before.every(forOne)) return { ...base, from: { refundOf: latest.key }, group };
      return { ...base, from: "back", group };
    }
    return { ...base, group };
  });
}
