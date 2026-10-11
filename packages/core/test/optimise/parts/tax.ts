/**
 * The household deduction: cleaning, yard work and a bathroom renovation paid to businesses in the judging year. The
 * near misses pay a person for cleaning and pay a business only 280 €.
 */
import type { InputValues } from "../../../src/optimise/types.ts";
import type { Transaction } from "../../../src/types.ts";
import type { Frame, Part, PartHousehold } from "../household.ts";

type Row = Partial<Transaction> & Pick<Transaction, "bookingDate" | "amountCents" | "merchant">;

/** Rows with ids of their own, so the part's rows keep their ids in any household. */
export function rowsOf(prefix: string, list: readonly Row[]): Transaction[] {
  return list.map((p, i) => ({
    id: `${prefix}-${String(i).padStart(4, "0")}`,
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
  }));
}

const yearOf = (frame: Frame) => frame.end.slice(0, 4);

const CLEANER = { merchant: "Puhdas Koti Oy", counterparty: "PUHDAS KOTI OY", counterpartyIban: "FI4950009420028730" };

/** Monthly cleaning from January to the last complete month of the year, 120 € each. */
export function cleaning(frame: Frame, cents = 12_000, payee: Pick<Transaction, "merchant" | "counterparty" | "counterpartyIban"> = CLEANER): Row[] {
  const months = frame.months.filter((m) => m.startsWith(`${yearOf(frame)}-`));
  return months.map((m) => ({ ...payee, bookingDate: `${m}-10`, amountCents: -cents, description: "LASKU KOTISIIVOUS" }));
}

/** 9 × 120 € cleaning, 2 × 320 € yard work, 2 000 € renovation in 2026: 1 720 € at full labour share, 2 000 € at 50–100 %. */
export const hit: Part["hit"] = (frame) => {
  const y = yearOf(frame);
  return {
    txs: rowsOf("tax", [
      ...cleaning(frame),
      // the lumps fall after July: before it they would swing the half-year that the joined household's July is judged against
      { merchant: "Pihatyö Virtanen Tmi", counterparty: "PIHATYÖ VIRTANEN TMI", counterpartyIban: "FI7944052020036082", bookingDate: `${y}-08-20`, amountCents: -32_000, description: "PIHATYÖT" },
      { merchant: "Pihatyö Virtanen Tmi", counterparty: "PIHATYÖ VIRTANEN TMI", counterpartyIban: "FI7944052020036082", bookingDate: `${y}-09-20`, amountCents: -32_000, description: "PIHATYÖT" },
      { merchant: "Remonttipalvelu Laine Oy", counterparty: "REMONTTIPALVELU LAINE OY", counterpartyIban: "FI5810171000000122", bookingDate: `${y}-08-12`, amountCents: -200_000, description: "KYLPYHUONEREMONTTI" },
    ]),
  };
};

export const nearMiss: Part["nearMiss"] = (frame): PartHousehold[] => [
  // a person paid for cleaning: no company form, a payee account, so never a business
  { txs: rowsOf("tax-person", cleaning(frame, 15_000, { merchant: "Maija Virtanen", counterparty: "MAIJA VIRTANEN", counterpartyIban: "FI2112345600000786" })) },
  // a business paid 280 € in the year: under the 300 € gate
  { txs: rowsOf("tax-small", cleaning(frame).slice(0, 2).map((r) => ({ ...r, amountCents: -14_000 }))) },
];

export const neutralValues: InputValues = {};
