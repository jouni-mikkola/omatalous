/**
 * Pienet tavat: R-Kioski 8 times a month at 4,20–6,60 €, 14 times in the last six months. Near misses: a rise of 40 %,
 * a card's sync gap a year ago, a rise whose saving stays under 200 € and a move from one kiosk to another.
 */
import type { InputValues } from "../../../src/optimise/types.ts";
import type { Account } from "../../../src/types.ts";
import type { Frame, Part, PartHousehold } from "../household.ts";
import { rows, spread } from "./food.ts";

/** Visits to a kiosk: `count(month)` a month on days over the whole week, 4,20–6,60 € (or `cents`). */
export function kiosk(
  prefix: string,
  f: Frame,
  count: (month: string, i: number) => number,
  opts: { accountId?: string; cents?: (k: number) => number; merchant?: string } = {},
): PartHousehold {
  const { add, out } = rows(prefix);
  const merchant = opts.merchant ?? "R-Kioski Kamppi";
  let k = 0;
  f.months.forEach((month, i) => {
    for (const date of spread(month, count(month, i))) {
      add({
        bookingDate: date,
        amountCents: -(opts.cents ?? ((n) => 420 + ((n * 97) % 240)))(k++),
        merchant,
        description: merchant.toUpperCase(),
        mcc: "5411",
        accountId: opts.accountId ?? "h-chk",
      });
    }
  });
  return { txs: out };
}

/** The last six complete months of the frame. */
export const recentMonths = (f: Frame) => new Set(f.months.slice(-6));

export const hit: Part["hit"] = (f) => {
  const recent = recentMonths(f);
  return kiosk("hab", f, (m) => (recent.has(m) ? 14 : 8));
};

/** A rise from 10 to 14 visits a month, 40 %; from `before` 9 it is 55 %. */
export function mild(f: Frame, before = 10): PartHousehold {
  const recent = recentMonths(f);
  return kiosk("hab-mild", f, (m) => (recent.has(m) ? 14 : before));
}

const CARD: Account = { id: "h-hab-card", name: "Kioskikortti", iban: null, currency: "EUR", type: "credit_card" };

/** The kiosk 14 times a month on a card that fetched nothing for three months a year ago: a gap, never a rise. */
export function syncGap(f: Frame): PartHousehold {
  const gap = new Set(f.months.slice(-18, -15));
  return { ...kiosk("hab-gap", f, (m) => (gap.has(m) ? 0 : 14), { accountId: CARD.id }), accounts: [CARD] };
}

/** A rise from 6 to 10 visits a month, but at 2 € a visit (or `cents`) the saving stays under 200 € a year. */
export function small(f: Frame, cents = 180): PartHousehold {
  const recent = recentMonths(f);
  return kiosk("hab-small", f, (m) => (recent.has(m) ? 10 : 6), { cents: (k) => cents + ((k * 13) % 40) });
}

/** After a move the household buys at R-Kioski Kamppi what it bought at R-Kioski Itis. With `keep` it still buys at both. */
export function moved(f: Frame, keep = false): PartHousehold {
  const recent = recentMonths(f);
  const before = kiosk("hab-move", f, (m) => (recent.has(m) ? 14 : 3));
  const old = kiosk("hab-old", f, (m) => (recent.has(m) && !keep ? 0 : 11), { merchant: "R-Kioski Itis" });
  return { txs: [...before.txs, ...old.txs] };
}

export const nearMiss: Part["nearMiss"] = (f) => [mild(f), syncGap(f), small(f), moved(f)];
export const neutralValues: InputValues = {};
