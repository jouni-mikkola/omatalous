/** 5 000 rows of a pool held by two accounts that copy each other, for the join tests (work: money-trace-rows.test.ts, time: money-trace-rows.perf.test.ts). */
import type { Transaction } from "../src/types.ts";
import { rng } from "./gen.ts";
import { tx } from "./helpers.ts";

const make = (accountId: string, prefix: string, next: () => number): Transaction[] =>
  Array.from({ length: 5000 }, (_, i) =>
    tx({ id: `${prefix}${i}`, accountId, bookingDate: `2025-0${1 + (i % 8)}-${String(1 + (i % 27)).padStart(2, "0")}`, amountCents: -100 - Math.floor(next() * 10), counterparty: `P${i % 40}`, merchant: "Test" }),
  );

const a = make("pool-a", "a", rng(4));
export const pair5000 = { a, b: a.map((t, i) => ({ ...t, id: `b${i}`, accountId: "pool-b" })) };
