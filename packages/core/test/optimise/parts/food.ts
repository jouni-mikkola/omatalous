/**
 * Ruoka: eating out that rose against the same months a year earlier, with Wolt orders behind most of it. The near
 * misses are what the reviewer looks for: a rise inside the month-to-month noise, party bills struck as one-offs, a
 * switch from one delivery service to another, MobilePay to a friend filed under restaurants and a card connected
 * inside the window.
 */
import { daysInMonth } from "../../../src/dates.ts";
import type { InputValues } from "../../../src/optimise/types.ts";
import type { Account, Transaction } from "../../../src/types.ts";
import type { Frame, Part, PartHousehold } from "../household.ts";

type Row = Partial<Transaction> & Pick<Transaction, "bookingDate" | "amountCents" | "merchant">;

/** Rows with ids under `prefix`, on the checking account unless they say otherwise. */
export function rows(prefix: string): { add: (p: Row) => void; out: Transaction[] } {
  const out: Transaction[] = [];
  const add = (p: Row) =>
    out.push({
      id: `${prefix}-${String(out.length).padStart(5, "0")}`,
      accountId: "h-chk",
      currency: "EUR",
      status: "booked",
      counterparty: null,
      counterpartyIban: null,
      description: null,
      mcc: null,
      category: "other",
      categorySource: "default",
      isTransfer: false,
      ...p,
    });
  return { add, out };
}

/** The day `d` of `month`, clamped to its length. */
export const on = (month: string, d: number) => `${month}-${String(Math.min(d, daysInMonth(month))).padStart(2, "0")}`;

/** `count` days spread over the month, the first on the 2nd. */
export const spread = (month: string, count: number) => Array.from({ length: count }, (_, k) => on(month, 2 + Math.floor((k * 26) / Math.max(1, count))));

/** The last six complete months of the frame. */
const nowMonths = (f: Frame) => f.months.slice(-6);

const pizza = (add: (p: Row) => void, date: string, cents: number) =>
  add({ bookingDate: date, amountCents: -cents, merchant: "Kotipizza", description: "KOTIPIZZA KAMPPI", mcc: "5814" });
const wolt = (add: (p: Row) => void, date: string, cents: number) => add({ bookingDate: date, amountCents: -cents, merchant: "Wolt", description: "WOLT HELSINKI" });
const foodora = (add: (p: Row) => void, date: string, cents: number) => add({ bookingDate: date, amountCents: -cents, merchant: "Foodora", description: "FOODORA HELSINKI" });

/** Kotipizza `visits(month)` times a month at 28–37 €. */
function pizzaMonths(add: (p: Row) => void, f: Frame, visits: (month: string) => number): void {
  let i = 0;
  for (const month of f.months) for (const date of spread(month, visits(month))) pizza(add, date, 2800 + ((i++ * 370) % 900));
}

export const hit: Part["hit"] = (f) => {
  const { add, out } = rows("food");
  const now = new Set(nowMonths(f));
  pizzaMonths(add, f, (m) => (now.has(m) ? 5 : 4));
  let j = 0;
  for (const month of f.months) for (const date of spread(month, now.has(month) ? 8 : 3)) wolt(add, on(month, Number(date.slice(8)) + 1), 2600 + ((j++ * 530) % 800));
  // a birthday dinner for twelve: over three times Kotipizza's median, struck from the level
  pizza(add, on(nowMonths(f)[2]!, 13), 32000);
  return { txs: out };
};

/**
 * A rise of the medians by 30 % and 60 € a month, but the months swing so much that the means do not stand apart.
 * `steady` gives the same medians without the swing, which is a rise.
 */
export function noisyRise(f: Frame, steady = false): PartHousehold {
  const { add, out } = rows("food-noise");
  const now = nowMonths(f);
  const then = f.months.slice(-18, -12);
  const thenVisits = steady ? [5, 5, 5, 5, 5, 5] : [2, 9, 4, 6, 3, 8];
  const nowVisits = steady ? [7, 6, 7, 6, 7, 7] : [3, 10, 6, 7, 4, 10];
  for (const month of f.months) {
    const visits = now.includes(month) ? nowVisits[now.indexOf(month)]! : then.includes(month) ? thenVisits[then.indexOf(month)]! : 5;
    for (const date of spread(month, visits)) add({ bookingDate: date, amountCents: -4000, merchant: "Ravintola Savotta", description: "RAVINTOLA SAVOTTA", mcc: "5812" });
  }
  return { txs: out };
}

/**
 * The same Kotipizza every month; five of the last six have a party bill of 400 €, each over three times the median.
 * At `cents` under three times the median the bills are more evenings out, which is a rise.
 */
export function partyMonths(f: Frame, cents = 40000): PartHousehold {
  const { add, out } = rows("food-party");
  pizzaMonths(add, f, () => 5);
  for (const month of nowMonths(f).slice(0, 5)) pizza(add, on(month, 20), cents);
  return { txs: out };
}

/** Six Foodora orders a month became six Wolt orders: delivery as a whole did not rise. With `keep` Foodora stays too. */
export function deliverySwitch(f: Frame, keep = false): PartHousehold {
  const { add, out } = rows("food-switch");
  pizzaMonths(add, f, () => 4);
  const switched = f.months.slice(-9)[0]!;
  let j = 0;
  for (const month of f.months) {
    for (const date of spread(month, 6)) {
      if (month >= switched) wolt(add, date, 2600 + ((j++ * 530) % 800));
      if (month < switched || keep) foodora(add, on(month, Number(date.slice(8)) + 1), 2600 + ((j++ * 530) % 800));
    }
  }
  return { txs: out };
}

/** MobilePay to a friend for dinners, filed under restaurants by hand: 300 € a month in the last six months. `paidTo` a restaurant, it is food. */
export function friendViaMobilePay(f: Frame, paidTo: "friend" | "restaurant" = "friend"): PartHousehold {
  const { add, out } = rows("food-friend");
  pizzaMonths(add, f, () => 4);
  for (const month of nowMonths(f)) {
    for (const date of spread(month, 3)) {
      if (paidTo === "friend") add({ bookingDate: date, amountCents: -10000, merchant: "Matti Meikäläinen", counterparty: "MATTI MEIKÄLÄINEN", description: "MOBILEPAY", category: "restaurants", categorySource: "user" });
      else add({ bookingDate: date, amountCents: -10000, merchant: "Ravintola Savotta", description: "RAVINTOLA SAVOTTA", mcc: "5812" });
    }
  }
  return { txs: out };
}

const CARD: Account = { id: "h-food-card", name: "Ruokakortti", iban: null, currency: "EUR", type: "credit_card" };

/** Eating out flat on the checking account; a card connected seven months ago carries 300 € a month more. `since` the start, it is a rise. */
export function newCard(f: Frame, since: "recent" | "start" = "recent"): PartHousehold {
  const { add, out } = rows("food-card");
  pizzaMonths(add, f, () => 4);
  if (since === "start") add({ bookingDate: on(f.months[0]!, 2), amountCents: -2500, merchant: "Kotipizza", description: "KOTIPIZZA KAMPPI", mcc: "5814", accountId: CARD.id });
  for (const month of f.months.slice(-7))
    for (const date of spread(month, 6)) add({ bookingDate: date, amountCents: -5000, merchant: "Ravintola Savotta", description: "RAVINTOLA SAVOTTA", mcc: "5812", accountId: CARD.id });
  return { txs: out, accounts: [CARD] };
}

export const nearMiss: Part["nearMiss"] = (f) => [noisyRise(f), partyMonths(f), deliverySwitch(f), friendViaMobilePay(f), newCard(f)];
export const neutralValues: InputValues = {};
