/**
 * A municipal day-care fee paid on the 10th, July free, that rose 15 % in August 2026 while pay stayed level. Lapset
 * makes no finding from it (the fee follows income, family size and hours): the check states the change. The near
 * misses: a 9 % rise with pay up 6 %, a 15 % rise with pay up 6 %, 279,90 → 335 € and the 80 → 90 % hour band at
 * level pay, and a private provider.
 */
import type { InputValues } from "../../../src/optimise/types.ts";
import type { Transaction } from "../../../src/types.ts";
import type { Frame, Part, PartHousehold } from "../household.ts";
import { rowsOf } from "./tax.ts";

const CITY = { merchant: "Espoon kaupunki", counterparty: "ESPOON KAUPUNKI", counterpartyIban: "FI0310093000048217", description: "VARHAISKASVATUSMAKSU" };
const PRIVATE = { merchant: "Touhula Päiväkodit Oy", counterparty: "TOUHULA PÄIVÄKODIT OY", counterpartyIban: "FI3715903000000876", description: "PÄIVÄKOTIMAKSU" };

/** The fee every month of the frame but July: `oldCents` before August 2026, `newCents` from it. */
export function daycare(frame: Frame, oldCents: number, newCents: number, payee: Partial<Transaction> & Pick<Transaction, "merchant"> = CITY) {
  const change = `${frame.end.slice(0, 4)}-08`;
  return frame.months.filter((m) => !m.endsWith("-07")).map((m) => ({ ...payee, bookingDate: `${m}-10`, amountCents: -(m < change ? oldCents : newCents) }));
}

/** A second job from January 2026 on: usual pay over February to July rises 6 % from 3 200 € to 3 392 €. */
function extraPay(frame: Frame) {
  return frame.months
    .filter((m) => m >= "2026-01")
    .map((m) => ({ merchant: "Lisätyö Oy", counterparty: "LISÄTYÖ OY", description: "PALKKA", bookingDate: `${m}-20`, amountCents: 19_200 }));
}

/** 280 € → 322 €: 15 % against the statutory 7,7 %, shown in the check only. */
export const hit: Part["hit"] = (frame) => ({ txs: rowsOf("kids", daycare(frame, 28_000, 32_200)) });

export const nearMiss: Part["nearMiss"] = (frame): PartHousehold[] => [
  { txs: rowsOf("kids-9-6", [...daycare(frame, 28_000, 30_520), ...extraPay(frame)]) },
  { txs: rowsOf("kids-15-6", [...daycare(frame, 28_000, 32_200), ...extraPay(frame)]) },
  { txs: rowsOf("kids-9", daycare(frame, 28_000, 30_520)) },
  { txs: rowsOf("kids-max", daycare(frame, 27_990, 33_500)) },
  { txs: rowsOf("kids-band", daycare(frame, 24_880, 30_150)) },
  { txs: rowsOf("kids-private", daycare(frame, 28_000, 32_200, PRIVATE)) },
];

export const neutralValues: InputValues = {};
