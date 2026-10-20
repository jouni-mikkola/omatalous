/**
 * Housing rows: a monthly vastike that rose 6,4 % on 5.1.2026 (312,00 € → 332,00 €) in an apartment block, where the
 * survey's rise for 2026 is 1,5 %.
 */
import { addMonths } from "../../../src/dates.ts";
import type { HousingType, InputValues } from "../../../src/optimise/types.ts";
import type { Transaction } from "../../../src/types.ts";
import type { Frame, Part, PartHousehold } from "../household.ts";

export interface ChargeOpts {
  merchant?: string;
  from?: number;
  to?: number;
  /** The first month at the new price. */
  changeMonth?: string;
  /** The first month of the series; the frame's first month by default. */
  firstMonth?: string;
  description?: string;
}

/** A monthly charge on the 5th from the first month up to today, with one price change. */
export function charges(frame: Frame, o: ChargeOpts = {}, prefix = "hs"): Transaction[] {
  const merchant = o.merchant ?? "As Oy Kotikallio";
  const out: Transaction[] = [];
  for (let month = o.firstMonth ?? frame.months[0]!; `${month}-05` <= frame.today; month = addMonths(month, 1)) {
    out.push({
      id: `${prefix}-${String(out.length).padStart(4, "0")}`,
      accountId: "h-chk",
      bookingDate: `${month}-05`,
      amountCents: -(month >= (o.changeMonth ?? "2026-01") ? (o.to ?? 33200) : (o.from ?? 31200)),
      currency: "EUR",
      status: "booked",
      merchant,
      counterparty: merchant.toUpperCase(),
      counterpartyIban: null,
      description: o.description ?? "VASTIKE",
      mcc: null,
      category: "other",
      categorySource: "default",
      isTransfer: false,
    });
  }
  return out;
}

export const housingType = (type: HousingType): InputValues => ({ housing_type: { value: type, asOf: "2026-10-01" } });

export const hit: Part["hit"] = (frame) => ({ txs: charges(frame), values: housingType("kerrostalo") });

export const nearMiss: Part["nearMiss"] = (frame): PartHousehold[] => [
  // 2 points over the survey: 3,5 % is under the price insight's own 5 % too
  { txs: charges(frame, { to: 32292 }), values: housingType("kerrostalo") },
  // a terraced house 2,7 points over its 2,8 %: a price rise, under the area's 3 points
  { txs: charges(frame, { to: 32916 }), values: housingType("rivitalo") },
  // a move to another home of the same landlord: the old price was another home's
  { txs: charges(frame, { merchant: "Sato", description: "VUOKRA", from: 80000, to: 95000 }), values: { ...housingType("vuokra"), moved_on: { value: "2025-12-20", asOf: "2026-01-02" } } },
];

/** A household without the patterns may have said what kind of home it lives in and when it moved in. */
export const neutralValues: InputValues = { housing_type: { value: "kerrostalo", asOf: "2025-11-01" }, moved_on: { value: "2023-11-01", asOf: "2025-11-01" } };
