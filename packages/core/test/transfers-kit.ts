import { addDays } from "../src/dates.ts";
import type { Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

/** `pairs` identical moves of 200 € from account a to account b, three days apart (work: transfers.test.ts, time: transfers.perf.test.ts). */
export function weeklyMoves(pairs: number): Transaction[] {
  const txs: Transaction[] = [];
  for (let i = 0; i < pairs; i++) {
    const day = addDays("2010-01-01", i * 3);
    txs.push(tx({ id: `o${i}`, accountId: "a", bookingDate: day, amountCents: -20000 }), tx({ id: `i${i}`, accountId: "b", bookingDate: day, amountCents: 20000 }));
  }
  return txs;
}
