/**
 * A car: fuel, a service, an inspection, insurance, vehicle tax and street parking four times a month at 9 €, with
 * one airport parking of 120 € that leaves the level. The hit has the permit price and the yearly distance. The near
 * misses park without a price, park only 280 € a year, and pay more for the permit than for parking.
 */
import type { InputValues } from "../../../src/optimise/types.ts";
import type { Frame, Part, PartHousehold } from "../household.ts";
import { rowsOf } from "./tax.ts";

const lastYear = (frame: Frame) => frame.months.slice(-12);

/** Street parking on the 5th, 12th, 19th and 26th of each of the last 12 months, `cents` each. */
export function parking(frame: Frame, cents = 900, perMonth = 4) {
  return lastYear(frame).flatMap((m) =>
    [5, 12, 19, 26].slice(0, perMonth).map((d) => ({ merchant: "EasyPark", description: "EASYPARK", mcc: "7523", bookingDate: `${m}-${String(d).padStart(2, "0")}`, amountCents: -cents })),
  );
}

function carRows(frame: Frame) {
  const months = lastYear(frame);
  const y = frame.end.slice(0, 4);
  return [
    ...months.map((m, i) => ({ merchant: "Neste Vantaa", description: "NESTE VANTAA", mcc: "5541", bookingDate: `${m}-08`, amountCents: -[7_000, 8_000, 9_000][i % 3]! })),
    { merchant: "EasyPark", description: "EASYPARK", mcc: "7523", bookingDate: `${y}-07-03`, amountCents: -12_000 },
    // the yearly costs fall in the first month: in spring they would swing the half-year before the joined household's July
    { merchant: "Vianor", description: "VIANOR", mcc: "7538", bookingDate: `${months[0]}-14`, amountCents: -45_000 },
    { merchant: "A-Katsastus", description: "A-KATSASTUS", bookingDate: `${months[0]}-20`, amountCents: -6_900 },
    { merchant: "Traficom", counterparty: "LIIKENNE- JA VIESTINTÄVIRASTO TRAFICOM", counterpartyIban: "FI1680001400050260", description: "AJONEUVOVERO", bookingDate: `${months[0]}-10`, amountCents: -23_000 },
    { merchant: "If", counterparty: "IF VAHINKOVAKUUTUS OYJ", counterpartyIban: "FI6880001300029010", description: "LIIKENNEVAKUUTUS", bookingDate: `${months[1]}-05`, amountCents: -21_000 },
    { merchant: "If", counterparty: "IF VAHINKOVAKUUTUS OYJ", counterpartyIban: "FI6880001300029010", description: "LIIKENNEVAKUUTUS", bookingDate: `${months[7]}-05`, amountCents: -21_000 },
  ];
}

const PRICED = "2026-09-01";

/** 48 × 9 € = 432 € of parking against a 180 € permit; 12 000 km. */
export const hit: Part["hit"] = (frame) => ({
  txs: rowsOf("car", [...parking(frame), ...carRows(frame)]),
  values: { parking_permit_price: { value: 18_000, asOf: PRICED }, car_km: { value: 12_000, asOf: PRICED } },
});

export const nearMiss: Part["nearMiss"] = (frame): PartHousehold[] => [
  { txs: rowsOf("car-noprice", parking(frame)) },
  { txs: rowsOf("car-small", parking(frame, 700).slice(0, 40)), values: { parking_permit_price: { value: 10_000, asOf: PRICED } } },
  { txs: rowsOf("car-dear", parking(frame)), values: { parking_permit_price: { value: 50_000, asOf: PRICED } } },
];

/** A household without street parking may still have typed both. */
export const neutralValues: InputValues = { parking_permit_price: { value: 18_000, asOf: "2025-11-01" }, car_km: { value: 15_000, asOf: "2025-11-01" } };
