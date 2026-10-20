/**
 * Statistics Finland's household electricity price per consumption band: the total price with energy, network and
 * taxes, c/kWh, table 13rb (updated 24.9.2026), read on 11.10.2026. Each row is the mean of the 12 monthly figures
 * from July 2025 to June 2026, so one season does not set the level. A row enters only after its source was read.
 */
import type { Fact } from "./index.ts";

const SOURCE = { title: "Tilastokeskus: Sähkön hinta kuluttajatyypeittäin (13rb)", url: "https://pxdata.stat.fi/PXWeb/pxweb/fi/StatFin/StatFin__ehi/13rb.px" };

const PERIOD = "heinäkuu 2025–kesäkuu 2026";

/** Band id (the table's consumer type), its words for the label and the mean of 7/2025 to 6/2026 in c/kWh. */
const BANDS: readonly [string, string, number][] = [
  ["A", "alle 1\u00a0000 kWh", 30.88],
  ["B", "1\u00a0000–2\u00a0499 kWh", 27.87],
  ["C", "2\u00a0500–4\u00a0999 kWh", 23.874],
  ["D", "5\u00a0000–15\u00a0000 kWh", 18.291],
  ["E", "yli 15\u00a0000 kWh", 15.525],
];

export const ELECTRICITY_FACTS: readonly Fact[] = BANDS.map(([band, words, value]) => ({
  id: `electricity_price:${band}`,
  label: `Keskihinta ${PERIOD}, kulutus ${words} vuodessa`,
  value,
  unit: "c/kWh",
  kind: "energy",
  status: "valid",
  validFrom: "2025-07-01",
  asOf: "2026-06-30",
  expires: "2026-12-30",
  source: SOURCE,
  verifiedAt: "2026-10-11",
}));
