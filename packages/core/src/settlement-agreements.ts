/**
 * The dated agreements of a settlement between partners: which one holds on a day, the weights a kind gives its users,
 * and what a fixed month owes. Pure: no database and no clock, whole cents, and only `cut` rounds.
 */
import { addMonths, dayNumber } from "./dates.ts";
import { compareOwners, cut, type Owner, sumCents } from "./money-trace-lots.ts";

/** An `account_agreement` row: `value` is the row's JSON, read leniently (a name that is no user is dropped). */
export interface AgreementRow {
  accountKey: string;
  /** `YYYY-MM-DD`: the agreement holds from this day until the next row of the same key. */
  validFrom: string;
  kind: "equal" | "share" | "income" | "fixed";
  value: Readonly<Record<string, unknown>>;
}
export interface Weight {
  owner: Owner;
  weight: number;
}
interface Share {
  owner: Owner;
  cents: number;
}
/** Earned income in cents by member and month (`YYYY-MM`). */
export type Incomes = ReadonlyMap<Owner, ReadonlyMap<string, number>>;

/** Weights and how they came about: `use` is the account's own use as said now; `gone` says the agreement named nobody who is left. */
export interface Weighted {
  weights: Weight[];
  how: "use" | "equal" | "share" | "income" | "card";
  incomeMissing: boolean;
  gone: boolean;
  from?: string;
}

const ORDER = (a: { owner: Owner }, b: { owner: Owner }): number => compareOwners(a.owner, b.owner);
const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []);
const numbers = (v: unknown): Weight[] =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.entries(v).flatMap(([owner, n]) => (typeof n === "number" && Number.isFinite(n) && Math.round(n) > 0 ? [{ owner, weight: Math.round(n) }] : []))
    : [];
const equalOf = (owners: readonly Owner[]): Weight[] => owners.map((owner) => ({ owner, weight: 1 }));

/** The row with the latest `validFrom` on or before `day`; `skipFixed` leaves the monthly kind out. */
export function agreementOn(rows: readonly AgreementRow[], key: string, day: number, skipFixed: boolean): AgreementRow | undefined {
  let best: AgreementRow | undefined;
  for (const a of rows) if (a.accountKey === key && (!skipFixed || a.kind !== "fixed") && dayNumber(a.validFrom) <= day && (!best || a.validFrom > best.validFrom)) best = a;
  return best;
}

/** The fixed agreement a month is under: the one valid on its first day, if that one is of kind fixed. */
export function fixedOf(rows: readonly AgreementRow[], key: string, month: string): AgreementRow | undefined {
  const a = agreementOn(rows, key, dayNumber(`${month}-01`), false);
  return a?.kind === "fixed" ? a : undefined;
}

/** Each owner's earned income over the six complete months before `month`; `m:` members weigh 0 (a `share` says theirs). */
function incomeWeights(owners: readonly Owner[], incomes: Incomes, month: string): number[] {
  return owners.map((o) => {
    if (o.startsWith("m:")) return 0;
    let sum = 0;
    for (let k = 1; k <= 6; k++) sum += incomes.get(o)?.get(addMonths(month, -k)) ?? 0;
    return Math.max(0, Math.round(sum));
  });
}

/** `total` cut over weights in owner order; nobody to cut over: the holder nobody names owes it, so no cent is lost. */
export function cutShares(total: number, weights: readonly Weight[]): Share[] {
  const list = weights.length ? [...weights].sort(ORDER) : [{ owner: "u:", weight: 1 }];
  const shares = cut(
    total,
    list.map((w) => w.weight),
  );
  return list.map((w, i) => ({ owner: w.owner, cents: shares[i]! })).filter((s) => s.cents !== 0);
}

/** The weights of a per-row agreement among `users` (the pool's users now); no agreement: the use as said now. */
export function agreementWeights(a: AgreementRow | undefined, users: readonly Weight[], incomes: Incomes, month: string): Weighted {
  const use: Weighted = { weights: [...users].sort(ORDER), how: "use", incomeMissing: false, gone: false };
  if (!a || a.kind === "fixed") return use;
  const current = new Set(users.map((u) => u.owner));
  let weights: Weight[];
  let incomeMissing = false;
  if (a.kind === "share") weights = numbers(a.value.weights).filter((w) => current.has(w.owner));
  else {
    const who = strings(a.value.who).filter((o) => current.has(o));
    weights = equalOf(who);
    if (a.kind === "income" && who.length) {
      const income = incomeWeights(who, incomes, month);
      if (sumCents(income) > 0) weights = who.map((owner, i) => ({ owner, weight: income[i]! })).filter((w) => w.weight > 0);
      else incomeMissing = true;
    }
  }
  if (!weights.length) return { ...use, gone: true, from: a.validFrom };
  return { weights: weights.sort(ORDER), how: a.kind, incomeMissing, gone: false, from: a.validFrom };
}

/** What a fixed agreement's `rest` says over `among`; anything it does not say well is equal. */
export function restWeights(rest: unknown, among: readonly Owner[], incomes: Incomes, month: string): { weights: Weight[]; incomeMissing: boolean } {
  const r = rest && typeof rest === "object" ? (rest as Record<string, unknown>) : {};
  if (r.kind === "share") {
    const w = numbers(r.weights).filter((x) => among.includes(x.owner));
    if (w.length) return { weights: w, incomeMissing: false };
  }
  if (r.kind === "income") {
    const income = incomeWeights(among, incomes, month);
    if (sumCents(income) > 0) return { weights: among.map((owner, i) => ({ owner, weight: income[i]! })).filter((w) => w.weight > 0), incomeMissing: false };
    return { weights: equalOf(among), incomeMissing: among.length > 0 };
  }
  return { weights: equalOf(among), incomeMissing: false };
}

interface FixedOwed {
  owed: Share[];
  /** The sum of the fixed amounts of users who are left, the month's net cost, and what is cut by `rest`. */
  fsum: number;
  c: number;
  r: number;
  incomeMissing: boolean;
}

/** What a fixed month owes: listed users their cents once the month's net cost `c` covers them, `rest` cuts the rest. */
export function fixedOwed(a: AgreementRow, users: readonly Weight[], incomes: Incomes, month: string, c: number): FixedOwed {
  const current = new Set(users.map((u) => u.owner));
  const listed = numbers(a.value.cents)
    .filter((w) => current.has(w.owner))
    .sort(ORDER);
  const fsum = sumCents(listed.map((l) => l.weight));
  const everyone = users.map((u) => u.owner).sort(compareOwners);
  const unlisted = everyone.filter((o) => !listed.some((l) => l.owner === o));
  const owed = new Map<Owner, number>();
  const add = (shares: readonly Share[]): void => {
    for (const s of shares) owed.set(s.owner, (owed.get(s.owner) ?? 0) + s.cents);
  };
  let r = c;
  let rest: ReturnType<typeof restWeights>;
  if (c <= 0) {
    rest = restWeights(a.value.rest, everyone, incomes, month);
    add(cutShares(c, rest.weights));
  } else if (c >= fsum) {
    r = c - fsum;
    add(listed.map((l) => ({ owner: l.owner, cents: l.weight })));
    rest = restWeights(a.value.rest, unlisted.length ? unlisted : everyone, incomes, month);
    add(cutShares(r, rest.weights));
  } else {
    r = 0;
    rest = { weights: [], incomeMissing: false };
    add(cutShares(c, listed));
  }
  return { owed: [...owed].map(([owner, cents]) => ({ owner, cents })).filter((s) => s.cents !== 0).sort(ORDER), fsum, c, r, incomeMissing: rest.incomeMissing && r !== 0 };
}

/**
 * Why a row may not be written, or null: a card takes `equal`, `share` or `income` only, and the row names a user of the
 * pool (`users`, weight above 0) in its `who`, `weights` or `cents`.
 */
export function agreementRefusal(a: AgreementRow, card: boolean, users: readonly Owner[]): "fixed_on_card" | "no_user" | null {
  if (card && a.kind === "fixed") return "fixed_on_card";
  const named = a.kind === "share" ? numbers(a.value.weights).map((w) => w.owner) : a.kind === "fixed" ? numbers(a.value.cents).map((w) => w.owner) : strings(a.value.who);
  return named.some((o) => users.includes(o)) ? null : "no_user";
}
