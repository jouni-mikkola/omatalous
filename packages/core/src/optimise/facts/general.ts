/**
 * Figures more than one area reads. CPI: the year-on-year change of the consumer price index per month, read on
 * 11.10.2026 from Statistics Finland's table 122p (updated 14.9.2026); July and August also stand in the release
 * "Inflaatio 2,2 % elokuussa 2026". The series ages as one: every row has the release's `asOf`.
 */
import { monthInessive } from "../../analysis/format.ts";
import type { Fact } from "./index.ts";

const RELEASE = { title: "Tilastokeskus: Inflaatio 2,2 % elokuussa 2026", url: "https://stat.fi/julkaisu/cmfazvwen2ssk07usvgxvpcq6" };
const TABLE = { title: "Tilastokeskus: Kuluttajahintaindeksin vuosimuutos, kuukausitiedot (122p)", url: "https://pxdata.stat.fi/PXWeb/pxweb/fi/StatFin/StatFin__khi/122p.px" };

/** Percent per month, as the table gives it. */
const CPI_YOY: readonly [string, number][] = [
  ["2024-09", 0.8],
  ["2024-10", 1.1],
  ["2024-11", 1.0],
  ["2024-12", 0.7],
  ["2025-01", 0.7],
  ["2025-02", 0.5],
  ["2025-03", 0.5],
  ["2025-04", 0.5],
  ["2025-05", 0.5],
  ["2025-06", 0.2],
  ["2025-07", 0.2],
  ["2025-08", 0.5],
  ["2025-09", 0.5],
  ["2025-10", -0.2],
  ["2025-11", -0.1],
  ["2025-12", 0.2],
  ["2026-01", -0.2],
  ["2026-02", 0.6],
  ["2026-03", 1.3],
  ["2026-04", 1.5],
  ["2026-05", 2.1],
  ["2026-06", 2.1],
  ["2026-07", 2.1],
  ["2026-08", 2.2],
];

export const GENERAL_FACTS: readonly Fact[] = CPI_YOY.map(([month, value]) => ({
  id: `cpi_yoy:${month}`,
  label: `Inflaatio ${monthInessive(month)} ${month.slice(0, 4)}`,
  value,
  unit: "%",
  kind: "cpi",
  status: "valid",
  validFrom: `${month}-01`,
  period: month,
  asOf: "2026-08-31",
  expires: "2027-02-28",
  source: month >= "2026-07" ? RELEASE : TABLE,
  verifiedAt: "2026-10-11",
}));
