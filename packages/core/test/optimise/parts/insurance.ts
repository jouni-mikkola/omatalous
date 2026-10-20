/**
 * Insurance rows: a monthly premium that rose 15,0 % on 3.12.2025 (100,00 € → 115,00 €) while consumer prices moved
 * 0,2 %, so its policy year renews on 3.12.2026, inside 60 days of the frame's today; and an offer typed for it.
 */
import { addMonths } from "../../../src/dates.ts";
import type { InputValues } from "../../../src/optimise/types.ts";
import type { Transaction } from "../../../src/types.ts";
import type { Frame, Part, PartHousehold } from "../household.ts";

export interface PremiumOpts {
  merchant?: string;
  from?: number;
  to?: number;
  /** The first month at the new price. */
  changeMonth?: string;
}

export const SERIES = "out:h-chk:LähiTapiola";

/** A monthly premium on the 3rd from the frame's first month up to today, with one price change. */
export function premiums(frame: Frame, o: PremiumOpts = {}, prefix = "in"): Transaction[] {
  const merchant = o.merchant ?? "LähiTapiola";
  const out: Transaction[] = [];
  for (let month = frame.months[0]!; `${month}-03` <= frame.today; month = addMonths(month, 1)) {
    out.push({
      id: `${prefix}-${String(out.length).padStart(4, "0")}`,
      accountId: "h-chk",
      bookingDate: `${month}-03`,
      amountCents: -(month >= (o.changeMonth ?? "2025-12") ? (o.to ?? 11500) : (o.from ?? 10000)),
      currency: "EUR",
      status: "booked",
      merchant,
      counterparty: merchant.toUpperCase(),
      counterpartyIban: null,
      description: "VAKUUTUSMAKSU",
      mcc: null,
      category: "other",
      categorySource: "default",
      isTransfer: false,
    });
  }
  return out;
}

export const quote = (cents: number, series = SERIES): InputValues => ({ [`insurance_quote:${series}`]: { value: cents, asOf: "2026-10-01" } });

export const hit: Part["hit"] = (frame) => ({ txs: premiums(frame), values: quote(115_000) });

export const nearMiss: Part["nearMiss"] = (frame): PartHousehold[] => [
  // 6,1 % in May 2026, when consumer prices moved 2,1 %: 4 points over
  { txs: premiums(frame, { to: 10610, changeMonth: "2026-05" }) },
];

/** Nothing: an offer belongs to one policy. */
export const neutralValues: InputValues = {};
