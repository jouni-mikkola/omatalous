/**
 * Vuosimenot: July costs 1 200 € more than usual in both years, and each summer the household draws credit in August and
 * pays 75 € of interest in August and in September. Near misses: one expensive July alone, and a July paid without
 * credit, which is no deadline in October. December comes from `decembers` on a longer history.
 */
import { addMonths } from "../../../src/dates.ts";
import type { InputValues } from "../../../src/optimise/types.ts";
import type { Transaction } from "../../../src/types.ts";
import type { Frame, Part, PartHousehold } from "../household.ts";
import { on, rows } from "./food.ts";

type Add = ReturnType<typeof rows>["add"];

/** Four purchases in the month, 1 200 € in all: none of them a one-off. */
export function expensive(add: Add, month: string, merchant = "Finnair", description = "FINNAIR"): void {
  [32000, 28000, 31000, 29000].forEach((cents, i) => add({ bookingDate: on(month, 3 + i * 6), amountCents: -cents, merchant, description }));
}

/** Credit drawn after the month and 75 € of interest in each of the two months after it. */
export function creditAfter(add: Add, month: string): void {
  const next = addMonths(month, 1);
  add({ bookingDate: on(next, 5), amountCents: 150000, merchant: "Nordea Rahoitus", counterparty: "NORDEA RAHOITUS", description: "LUOTON NOSTO" });
  for (const m of [next, addMonths(month, 2)]) add({ bookingDate: on(m, 28), amountCents: -7500, merchant: "Luottokorko", description: "LUOTTOKORKO" });
}

/** The July of the last complete year and the one before it. */
export const julys = (f: Frame) => f.months.filter((m) => m.endsWith("-07")).slice(-2);

export const hit: Part["hit"] = (f) => {
  const { add, out } = rows("sea");
  for (const month of julys(f)) {
    expensive(add, month);
    creditAfter(add, month);
  }
  return { txs: out };
};

/** Only the last July was expensive: one year is chance. */
export function oneYear(f: Frame): PartHousehold {
  const { add, out } = rows("sea-one");
  expensive(add, julys(f)[1]!);
  return { txs: out };
}

/** Both Julys expensive and paid without credit: July starts over 60 days after the judging day, so no deadline. */
export function noCredit(f: Frame): PartHousehold {
  const { add, out } = rows("sea-cash");
  for (const month of julys(f)) expensive(add, month);
  return { txs: out };
}

/**
 * December gifts in two years, for a history long enough to judge December (household.ts starts in October). With
 * `lastYear` set to flights, the two Decembers were dear for different reasons.
 */
export function decembers(f: Frame, lastYear: "gifts" | "flights" = "gifts"): Transaction[] {
  const { add, out } = rows("sea-dec");
  const [first, last] = f.months.filter((m) => m.endsWith("-12")).slice(-2);
  expensive(add, first!, "Stockmann", "STOCKMANN HELSINKI");
  if (lastYear === "gifts") expensive(add, last!, "Stockmann", "STOCKMANN HELSINKI");
  else expensive(add, last!);
  return out;
}

export const nearMiss: Part["nearMiss"] = (f) => [oneYear(f), noCredit(f)];
export const neutralValues: InputValues = {};
