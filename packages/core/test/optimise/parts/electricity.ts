/**
 * Electricity rows: a seller and a network company billing every month for the 24 months, the year up to the frame's
 * end at 22,9 c/kWh against the 5 000–15 000 kWh band's 18,3 c/kWh, and a fixed-term contract that ends on 31.12.
 */
import { addMonths, daysInMonth } from "../../../src/dates.ts";
import type { InputValues } from "../../../src/optimise/types.ts";
import type { Transaction } from "../../../src/types.ts";
import type { Frame, Part, PartHousehold } from "../household.ts";

export interface BillOpts {
  /** Seller cents in a winter month (November to March) and in another month. */
  seller?: [number, number] | null;
  /** Network cents a month. */
  network?: number | null;
  sellerName?: string;
  networkName?: string;
  /** Extra rows. */
  extra?: (row: Row) => Transaction[];
}

type Row = (date: string, cents: number, merchant: string) => Transaction;

/** Monthly seller and network bills from the frame's first month up to today. */
export function bills(frame: Frame, o: BillOpts = {}, prefix = "el"): Transaction[] {
  let n = 0;
  const row: Row = (date, cents, merchant) => ({
    id: `${prefix}-${String(n++).padStart(4, "0")}`,
    accountId: "h-chk",
    bookingDate: date,
    amountCents: -cents,
    currency: "EUR",
    status: "booked",
    merchant,
    counterparty: merchant.toUpperCase(),
    counterpartyIban: null,
    description: "LASKU",
    mcc: null,
    category: "other",
    categorySource: "default",
    isTransfer: false,
  });
  const out: Transaction[] = [];
  const seller = o.seller === undefined ? ([15000, 10000] as [number, number]) : o.seller;
  const network = o.network === undefined ? 7000 : o.network;
  for (const month of [...frame.months, addMonths(frame.months[frame.months.length - 1]!, 1)]) {
    const on = (d: number) => `${month}-${String(Math.min(d, daysInMonth(month))).padStart(2, "0")}`;
    const winter = [1, 2, 3, 11, 12].includes(Number(month.slice(5)));
    if (seller && on(10) <= frame.today) out.push(row(on(10), winter ? seller[0] : seller[1], o.sellerName ?? "Oomi Energia"));
    if (network && on(20) <= frame.today) out.push(row(on(20), network, o.networkName ?? "Caruna"));
  }
  out.push(...(o.extra?.(row) ?? []));
  return out;
}

export const KWH: InputValues = { electricity_kwh: { value: 10_000, asOf: "2026-10-01" } };

export const hit: Part["hit"] = (frame) => ({
  // a connection fee to the network company: over three times its median, so it leaves the level
  txs: bills(frame, { extra: (row) => [row("2026-05-05", 45000, "Caruna")] }),
  values: { ...KWH, electricity_contract_end: { value: "2026-12-31", asOf: "2026-10-01" } },
});

export const nearMiss: Part["nearMiss"] = (frame): PartHousehold[] => [
  // a seller's bills only: the price would be too low to compare
  { txs: bills(frame, { network: null }), values: KWH },
  // 1,5 c/kWh over the band: 1 980 € for 10 000 kWh
  { txs: bills(frame, { seller: [11500, 11500], network: 5000 }), values: KWH },
  // a move inside the window: the year of bills is not one home's
  { txs: bills(frame), values: { ...KWH, moved_on: { value: "2026-03-01", asOf: "2026-03-05" } } },
];

/** A household without the patterns may have typed its use. */
export const neutralValues: InputValues = { electricity_kwh: { value: 10_000, asOf: "2025-11-01" } };
