/**
 * An `income` agreement, and a `fixed` one whose remainder is `income`, shows the partners' income ratio, which comes from
 * accounts each of them keeps to themselves, so one partner alone cannot put one in force. Such a row carries `confirmed` in its
 * value: the users who have put the same row (a `fixed` row also `who`, the users of the pool when it was put). It stands only
 * when every user it names has. A row with no such list (any other kind) is in force.
 */
import { isDeepStrictEqual } from "node:util";
import type { Owner } from "@banking/core";

export interface Pending {
  who: Owner[];
  confirmed: Owner[];
  /** The named users who have not put the row yet. */
  waiting: Owner[];
}

/** The strings of a list, once each, as core reads `who`: anything else in it is dropped, and no list is none. */
const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []);

function objectOf(value: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(value);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Does this agreement show the income ratio: kind income, or fixed with the remainder cut by income. */
const showsIncome = (kind: string, value: Record<string, unknown> | null): boolean => kind === "income" || (kind === "fixed" && (value?.rest as { kind?: unknown } | undefined)?.kind === "income");

/** The users a new row has to wait for, or null when it needs nobody's confirmation: `who` of an income row, the pool's `users` for a fixed one. */
export function namedUsers(kind: string, value: Record<string, unknown>, users: readonly Owner[]): Owner[] | null {
  if (!showsIncome(kind, value)) return null;
  return kind === "income" ? (value.who as Owner[]) : [...users];
}

/** What a row still waits for; null when it is in force (another kind, or everyone named has). A name that is no login cannot put anything and is not waited for. */
export function pendingOf(row: { kind: string; value: string }): Pending | null {
  const v = objectOf(row.value);
  if (!showsIncome(row.kind, v)) return null;
  // fails closed: a `confirmed` that is missing or no list says nobody has put the row
  const who = strings(v?.who);
  const confirmed = strings(v?.confirmed);
  const waiting = who.filter((o) => o.startsWith("u:") && o !== "u:" && !confirmed.includes(o));
  return waiting.length ? { who, confirmed, waiting } : null;
}

/** The value of a row as the sums read it: what the writer gave, with no record of who has put it. */
export function plainValue(kind: string, value: Record<string, unknown>): Record<string, unknown> {
  const { confirmed: _, who, ...rest } = value;
  return kind === "fixed" ? rest : { ...rest, ...(who === undefined ? {} : { who }) };
}

/** Is `value` the row that waits in `stored`: the same agreement of the same users, whatever order they are named in. */
export function sameRow(kind: string, stored: string, value: Record<string, unknown>): boolean {
  const a = plainValue(kind, objectOf(stored) ?? {});
  const b = plainValue(kind, value);
  return kind === "income" ? isDeepStrictEqual({ ...a, who: [...((a.who as string[]) ?? [])].sort() }, { ...b, who: [...((b.who as string[]) ?? [])].sort() }) : isDeepStrictEqual(a, b);
}

/** The stored value with one more user who has put it. */
export function confirmedBy(stored: string, owner: Owner): string {
  const v = objectOf(stored) ?? {};
  return JSON.stringify({ ...v, confirmed: [...(strings(v.confirmed) ?? []), owner] });
}

/** The value of an income or income-remainder row as an import writes it: put by this user alone, whatever the file says. Any other value is left as it is. */
export function confirmedByOnly(kind: string, value: string, owner: Owner, users: readonly Owner[]): string {
  const v = objectOf(value);
  if (!v || !showsIncome(kind, v)) return value;
  if (kind === "income") return JSON.stringify({ ...v, confirmed: [owner] });
  return JSON.stringify({ ...v, who: [...new Set([...users, owner])], confirmed: [owner] });
}
