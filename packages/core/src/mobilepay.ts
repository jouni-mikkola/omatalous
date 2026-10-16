/**
 * MobilePay money in that names no sender ("Tiedot MobilePay-sovelluksessa"): friends paying their share of something
 * the household bought. `matchMobilePayShares` sets each such row against the purchase it most likely paid for, so the
 * share lowers that purchase's category and is no income (the caller gives the row the purchase's category).
 */
import { fold } from "./merchant.ts";

/** How many days after a purchase a friend's share may come. */
export const SHARE_DAYS = 7;
/** A share is the purchase divided by the number of payers, within this many cents. */
const SHARE_TOLERANCE = 100;
/** The most people one purchase is split between, and the fewest. */
const MIN_PAYERS = 2;
const MAX_PAYERS = 10;

/** The words a bank writes around a MobilePay payment that names nobody. */
const NAMELESS_WORDS = new Set(["TIEDOT", "MOBILEPAY", "MOBILE", "PAY", "SOVELLUKSESSA", "SOVELLUKSEN", "SOVELLUS", "APPISSA", "MAKSU", "SIIRTO", "VIPPS", "PIVO", "SAAPUNUT", "SAAPUVA", "DETAILS", "IN", "THE", "APP", "SEE"]);
const WALLET_WORDS = new Set(["MOBILEPAY", "VIPPS", "PIVO"]);

/** Whether a payment's counterparty and text name only the wallet and no one: nothing but the words a bank writes around it. */
export function isUnnamedMobilePay(t: { counterparty?: string | null; description?: string | null }): boolean {
  const words = fold([t.counterparty, t.description].filter(Boolean).join(" ")).split(/[^\p{L}]+/u).filter(Boolean);
  return words.some((w) => WALLET_WORDS.has(w)) && words.every((w) => NAMELESS_WORDS.has(w));
}

/** Categories a friend's share is never set against: bills and contracts, cash, people and card bills are no shared purchase. */
const NOT_SHARED = new Set(["housing", "utilities", "telecom", "insurance", "taxes", "fees", "memberships", "cash", "p2p", "card_bill"]);
export const isSharedPurchase = (category: string): boolean => !NOT_SHARED.has(category);

/** How many days before an answered share the purchase it belongs to may be. */
const ANSWERED_DAYS = 14;

interface Dated {
  id: string;
  day: number;
  /** Positive cents. */
  cents: number;
}

/** The purchase an answered share nets against: the nearest in time within `ANSWERED_DAYS` days before it, then the larger, then the lower id. */
export function nearestPurchase(purchases: readonly Dated[], row: Dated): Dated | null {
  const near = purchases.filter((p) => row.day >= p.day && row.day - p.day <= ANSWERED_DAYS);
  near.sort((a, b) => b.day - a.day || b.cents - a.cents || (a.id < b.id ? -1 : 1));
  return near[0] ?? null;
}

/** Whether one share is about the purchase divided by some number of payers. */
const isShareOf = (share: number, purchase: number): boolean => {
  for (let n = MIN_PAYERS; n <= MAX_PAYERS; n++) if (Math.abs(share * n - purchase) <= SHARE_TOLERANCE * n) return true;
  return false;
};

/** Whether `sum` is what the other payers pay together: the purchase less the household's own share, for some number of payers. */
const isOthersTogether = (sum: number, purchase: number): boolean => {
  for (let n = MIN_PAYERS; n <= MAX_PAYERS; n++) if (Math.abs(sum * n - purchase * (n - 1)) <= SHARE_TOLERANCE * n) return true;
  return false;
};

/**
 * Incoming row id → the purchase it paid a share of. A row looks at the purchases 0 to `SHARE_DAYS` days before it
 * (a purchase the row is not larger than): the nearest in time first, then the larger. A purchase takes it when the
 * row is about the purchase divided by 2 to 10, and the shares taken stay under the purchase; or, when the row alone is
 * no share, when it and the rows still unmatched in that purchase's window (two at least) together come to the purchase
 * less one share. A row nets against one purchase at most. Rows are read in date and id order and each is decided from
 * itself and the rows before it, so a row that arrives later never moves a match made already.
 */
export function matchMobilePayShares(purchases: readonly Dated[], incoming: readonly Dated[]): Map<string, string> {
  const rows = [...incoming].sort((a, b) => a.day - b.day || (a.id < b.id ? -1 : 1));
  const buys = [...purchases].sort((a, b) => a.day - b.day || (a.id < b.id ? -1 : 1));
  const taken = new Map<string, number>();
  const matches = new Map<string, string>();
  const pending: Dated[] = [];
  for (const row of rows) {
    const near = buys
      .filter((p) => row.day >= p.day && row.day - p.day <= SHARE_DAYS && row.cents < p.cents)
      .sort((a, b) => row.day - a.day - (row.day - b.day) || b.cents - a.cents || (a.id < b.id ? -1 : 1));
    const claim = (p: Dated, group: readonly Dated[]) => {
      for (const r of group) matches.set(r.id, p.id);
      taken.set(p.id, (taken.get(p.id) ?? 0) + group.reduce((sum, r) => sum + r.cents, 0));
      for (const r of group) pending.splice(pending.indexOf(r), 1);
    };
    pending.push(row);
    let done = false;
    for (const p of near) {
      if ((taken.get(p.id) ?? 0) + row.cents < p.cents && isShareOf(row.cents, p.cents)) {
        claim(p, [row]);
        done = true;
        break;
      }
    }
    if (done) continue;
    for (const p of near) {
      const group = pending.filter((r) => r.day >= p.day && r.day - p.day <= SHARE_DAYS);
      const sum = (taken.get(p.id) ?? 0) + group.reduce((s, r) => s + r.cents, 0);
      if (group.length >= 2 && sum < p.cents && isOthersTogether(sum, p.cents)) {
        claim(p, group);
        break;
      }
    }
  }
  return matches;
}
