/**
 * Benchmarks for a housing charge rise, read on 11.10.2026.
 * - Hoitovastike: Kiinteistöliitto's survey of its member companies (over 4 800 answers in May 2026), published
 *   17.6.2026: 1,5 % in apartment blocks and 2,8 % in terraced houses in 2026. A survey stands for other households,
 *   so it costs a certainty step. The id carries the year: a rise in another year has no benchmark.
 * - Rent: Statistics Finland's rent index, the year-on-year change per quarter for the whole country, all rental
 *   dwellings and by financing (table 15fa, updated 16.7.2026). An index ages like CPI, so kind `cpi`.
 */
import type { Fact } from "./index.ts";

const SURVEY = {
  title: "Kiinteistöliitto: Taloyhtiöiden hoitovastikkeiden nousuvauhti hidastunut (17.6.2026)",
  url: "https://www.sttinfo.fi/tiedote/72143574/taloyhtioiden-hoitovastikkeiden-nousuvauhti-hidastunut?lang=fi",
};
const RENT = { title: "Tilastokeskus: Vuokraindeksi ja keskineliövuokrat, neljännesvuosittain (15fa)", url: "https://pxdata.stat.fi/PXWeb/pxweb/fi/StatFin/StatFin__asvu/15fa.px" };

const survey = (type: "kerrostalo" | "rivitalo", words: string, value: number): Fact => ({
  id: `hoitovastike_rise:${type}:2026`,
  label: `Hoitovastikkeiden nousu ${words} vuonna 2026, kysely`,
  value,
  unit: "%",
  kind: "survey",
  status: "valid",
  validFrom: "2026-01-01",
  asOf: "2026-05-31",
  expires: "2027-05-31",
  source: SURVEY,
  verifiedAt: "2026-10-11",
});

/** Quarter, all rental dwellings, free-financed, state-subsidised (ARA): the year-on-year change in percent. */
const RENT_YOY: readonly [string, number, number, number][] = [
  ["2026Q1", 0.7, 0.1, 2.2],
  ["2026Q2", 0.6, 0.1, 1.8],
];

const QUARTER_START = ["01", "04", "07", "10"];

const rent = (id: string, quarter: string, words: string, value: number): Fact => ({
  id: `${id}:${quarter}`,
  label: `Vuokraindeksin vuosimuutos ${quarter.slice(5)}. neljänneksellä ${quarter.slice(0, 4)}, ${words}`,
  value,
  unit: "%",
  kind: "cpi",
  status: "valid",
  validFrom: `${quarter.slice(0, 4)}-${QUARTER_START[Number(quarter.slice(5)) - 1]}-01`,
  asOf: "2026-06-30",
  expires: "2026-12-30",
  source: RENT,
  verifiedAt: "2026-10-11",
});

export const HOUSING_FACTS: readonly Fact[] = [
  survey("kerrostalo", "kerrostaloissa", 1.5),
  survey("rivitalo", "rivitaloissa", 2.8),
  ...RENT_YOY.flatMap(([q, all, free, ara]) => [
    rent("rent_index_yoy", q, "kaikki vuokra-asunnot", all),
    rent("rent_index_yoy_free", q, "vapaarahoitteiset", free),
    rent("rent_index_yoy_ara", q, "valtion tukemat", ara),
  ]),
];
