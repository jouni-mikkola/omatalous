import { addDays } from "../src/dates.ts";
import type { Transaction } from "../src/types.ts";

let seq = 0;

export function tx(partial: Partial<Transaction> & Pick<Transaction, "bookingDate" | "amountCents">): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: "acc-1",
    currency: "EUR",
    status: "booked",
    counterparty: null,
    counterpartyIban: null,
    description: null,
    mcc: null,
    merchant: "Test",
    category: "other",
    categorySource: "default",
    isTransfer: false,
    ...partial,
  };
}

/** `count` charges every `everyDays` days starting at `start`. */
export function series(
  start: string,
  everyDays: number,
  count: number,
  amountCents: number | ((i: number) => number),
  partial: Partial<Transaction> = {},
): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    tx({
      ...partial,
      bookingDate: addDays(start, Math.round(i * everyDays)),
      amountCents: typeof amountCents === "function" ? amountCents(i) : amountCents,
    }),
  );
}
