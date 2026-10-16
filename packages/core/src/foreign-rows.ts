// Decision: a bank row whose own currency is not the euro is kept apart from the euro rows, in the bank's own figure, and never summed with them.

/** The code for "no currency" (ISO 4217): a row whose currency the bank did not name properly. */
const UNKNOWN_CURRENCY = "XXX";

/**
 * The currency a row is in: the code the bank sent for the amount, trimmed and in capitals, when it is three letters;
 * otherwise `XXX`. Neither the account's currency nor the euro stands in for a missing one.
 */
export function foreignCurrencyOf(code: unknown): string {
  const c = typeof code === "string" ? code.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(c) ? c : UNKNOWN_CURRENCY;
}

/** An amount as the bank wrote it: whole units in `minor` at `scale` decimals (1 234 at scale 3 is 1,234). */
interface MinorAmount {
  minor: number;
  scale: number;
}

/**
 * Reads the bank's decimal text by its digits (no float): `scale` is the number of decimals as sent, 0 to 3, and `minor`
 * the signed integer of all digits. The bank's direction decides the sign (DBIT minus, CRDT plus); the sign of the text
 * counts only when the direction is missing. Null for anything that is not a plain decimal with at most three decimals.
 */
export function parseForeignAmount(text: unknown, indicator: unknown): MinorAmount | null {
  const s = typeof text === "number" ? String(text) : typeof text === "string" ? text.trim() : "";
  const m = /^([+-]?)(\d{1,15})(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const decimals = m[3] ?? "";
  const abs = Number(`${m[2]}${decimals}`);
  if (!Number.isSafeInteger(abs)) return null;
  const negative = indicator === "DBIT" ? true : indicator === "CRDT" ? false : m[1] === "-";
  return { minor: negative ? -abs : abs, scale: decimals.length };
}

/** One currency's rows of an account: how many, and their sum when every row has the same scale (else null). */
export interface ForeignTotal {
  currency: string;
  count: number;
  totalMinor: number | null;
  /** The scale of `totalMinor`; null with it. */
  scale: number | null;
}

/** Per currency the count and the signed total. Never added across currencies; currencies in code order. */
export function foreignTotals(rows: readonly { currency: string; amountMinor: number; scale: number }[]): ForeignTotal[] {
  const by = new Map<string, { count: number; sum: number; scales: Set<number> }>();
  for (const r of rows) {
    const t = by.get(r.currency) ?? { count: 0, sum: 0, scales: new Set<number>() };
    t.count++;
    t.sum += r.amountMinor;
    t.scales.add(r.scale);
    by.set(r.currency, t);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, t]) => {
      const one = t.scales.size === 1;
      return { currency, count: t.count, totalMinor: one ? t.sum : null, scale: one ? [...t.scales][0]! : null };
    });
}

/** An amount for reading: Finnish decimal comma, thousands apart by a no-break space, a plus or minus in front when `signed`. No currency sign. */
export function formatForeignAmount(minor: number, scale: number, signed = false): string {
  const abs = String(Math.abs(minor)).padStart(scale + 1, "0");
  const whole = abs.slice(0, abs.length - scale).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const text = scale ? `${whole},${abs.slice(abs.length - scale)}` : whole;
  return minor < 0 ? `−${text}` : signed && minor > 0 ? `+${text}` : text;
}

/** The newest booking day of a foreign row, per account: what the day walk needs to know (`balanceWalk`). */
export interface ForeignDay {
  accountId: string;
  count: number;
  /** The newest booking day (YYYY-MM-DD) of the account's rows in another currency. */
  newestDay: string;
}
