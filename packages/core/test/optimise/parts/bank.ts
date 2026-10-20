/**
 * Pankkikulut. The hit: a connected Nordea Platinum card charged 16,99 € a month with purchases on it (168 € a year
 * against the Credit card's 2,99 €) and four reminder fees of 35 € in the year (140 €). Near misses: a Gold card,
 * a Platinum fee charged five times, a Platinum-priced fee on the checking account, a Platinum card without purchases,
 * a second 16,99 fee beside a Credit card's 2,99, two reminder fees under the gate and a Platinum-priced card that came
 * through another bank's connection.
 */
import { addMonths, daysInMonth, monthRange } from "../../../src/dates.ts";
import type { InputValues } from "../../../src/optimise/types.ts";
import type { Account, Transaction } from "../../../src/types.ts";
import type { Frame, Part, PartHousehold } from "../household.ts";

export const CARD: Account = { id: "h-card", name: "Nordea Platinum", iban: null, currency: "EUR", type: "credit_card" };
const OTHER_BANK_CARD: Account = { ...CARD, name: "Platinum", bank: "Bank Norwegian" };

function rows(prefix: string) {
  const out: Transaction[] = [];
  const add = (p: Pick<Transaction, "bookingDate" | "amountCents" | "merchant" | "description"> & Partial<Transaction>) =>
    out.push({
      id: `${prefix}-${String(out.length).padStart(4, "0")}`,
      accountId: CARD.id,
      currency: "EUR",
      status: "booked",
      counterparty: null,
      counterpartyIban: null,
      mcc: null,
      category: "other",
      categorySource: "default",
      isTransfer: false,
      ...p,
    });
  return { out, add };
}

const on = (month: string, day: number) => `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
const monthsOf = (frame: Frame, from = frame.months[0]!) => monthRange(from, addMonths(frame.months[frame.months.length - 1]!, 1));

/** A card fee on the 1st of each month from `from`, and purchases every week unless `purchases` is false. */
function card(frame: Frame, prefix: string, cents: number, opts: { from?: string; purchases?: boolean; accountId?: string } = {}) {
  const r = rows(prefix);
  for (const month of monthsOf(frame, opts.from)) {
    if (on(month, 1) > frame.today) break;
    r.add({ bookingDate: on(month, 1), amountCents: -cents, merchant: "Nordea", description: "KORTTIMAKSU", accountId: opts.accountId ?? CARD.id });
    // a weekly purchase: a card account silent for two weeks reads as a gap in its data
    for (const day of opts.purchases === false ? [] : [4, 11, 18, 25]) {
      if (on(month, day) <= frame.today) r.add({ bookingDate: on(month, day), amountCents: -2000, merchant: "Stockmann Helsinki", description: "STOCKMANN HELSINKI", mcc: "5311" });
    }
  }
  return r.out;
}

function reminders(prefix: string, dates: readonly string[], cents: number) {
  const r = rows(prefix);
  for (const d of dates) r.add({ bookingDate: d, amountCents: -cents, merchant: "Intrum Oy", counterparty: "INTRUM OY", description: "MUISTUTUSMAKSU", accountId: "h-chk" });
  return r.out;
}

export const hit: Part["hit"] = (frame) => ({
  txs: [...card(frame, "bank-card", 1699), ...reminders("bank-late", ["2025-11-20", "2026-02-20", "2026-05-20", "2026-08-20"], 3500)],
  accounts: [CARD],
});

export const nearMiss: Part["nearMiss"] = (frame): PartHousehold[] => [
  { txs: card(frame, "bank-gold", 599), accounts: [{ ...CARD, name: "Nordea Gold" }] },
  // five charges, June to October 2026
  { txs: card(frame, "bank-new", 1699, { from: "2026-06" }), accounts: [CARD] },
  { txs: card(frame, "bank-chk", 1699, { accountId: "h-chk", purchases: false }) },
  { txs: card(frame, "bank-idle", 1699, { purchases: false }), accounts: [CARD] },
  // a Credit card paying 2,99 with a second fee of 16,99 beside it
  { txs: [...card(frame, "bank-two", 299), ...card(frame, "bank-extra", 1699, { purchases: false })], accounts: [{ ...CARD, name: "Nordea Credit" }] },
  { txs: reminders("bank-few", ["2026-02-20", "2026-08-20"], 500) },
  // another bank's card at Platinum's price: it has no IBAN either, and its connection names the bank
  { txs: card(frame, "bank-other", 1699), accounts: [OTHER_BANK_CARD] },
];

export const neutralValues: InputValues = {};
