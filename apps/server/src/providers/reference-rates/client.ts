/**
 * The published euribor fixings, from the report pages of the Bank of Finland (reports.suomenpankki.fi, no key). Two
 * reports: the last fixing (about 1,5 kB) and the daily fixings since 2021 (about 700 kB).
 *
 * The request carries no data of the household. The answer is untrusted outside data: it is size-limited, read by its
 * known shape only and checked value by value before anything else sees it. A report whose shape changed is refused
 * whole, so the loans keep counting at the fixings stored before.
 */
import type { Fixings, IsoDate } from "@banking/core";
import { readCappedText } from "../../platform/outbound.ts";
import { isIsoDate } from "../../platform/validate.ts";

export type EuriborReference = keyof Fixings;

export const EURIBOR_REFERENCES = ["euribor_3", "euribor_6", "euribor_12"] as const satisfies readonly EuriborReference[];

/** One published fixing: the rate in thousandths of a percent as published (3328 is 3,328 %), negative where it was. */
export interface FixingRow {
  reference: EuriborReference;
  day: IsoDate;
  rateMilli: number;
}

export type Report = "today" | "history";

const REPORT_NAMES: Record<Report, string> = { today: "euribor_korot_today_xml_fi", history: "euribor_korot_xml_short_fi" };

export const REFERENCE_RATES_URL = "https://reports.suomenpankki.fi/WebForms/ReportViewerPage.aspx";

/** The daily report was 690 kB in 2026 and grows by about 100 kB a year. */
const MAX_BYTES = 2_000_000;
/** A safety cap only: a report that holds more days than this is not the one asked for. */
const MAX_PERIODS = 10_000;
/** The rates a fixing may have, in thousandths of a percent: −5 % to 20 %. Euribor was −0,6 % at its lowest. */
const MIN_MILLI = -5000;
const MAX_MILLI = 20_000;

/** The series by their exact names: the report holds a 365-day series of 3 kk too, which is left out. */
const SERIES = new Map<string, EuriborReference>([
  ["3 kk (tod.pv/360)", "euribor_3"],
  ["6 kk (tod.pv/360)", "euribor_6"],
  ["12 kk (tod.pv/360)", "euribor_12"],
]);

export class ReferenceRatesError extends Error {}

const attribute = (attributes: string, name: string): string | null => new RegExp(`^\\s*${name}="([^"]*)"\\s*$`).exec(attributes)?.[1] ?? null;

/** "3,328" as 3328 and "-0,543" as -543: a decimal comma number with one to three decimals, nothing else. */
function milliOf(text: string): number {
  const m = /^(-?)(\d{1,2}),(\d{1,3})$/.exec(text);
  if (!m) throw new ReferenceRatesError("report holds a rate that is no decimal comma number");
  const milli = (Number(m[2]) * 1000 + Number(m[3]!.padEnd(3, "0"))) * (m[1] ? -1 : 1);
  if (milli < MIN_MILLI || milli > MAX_MILLI) throw new ReferenceRatesError("report holds a rate outside -5 to 20 %");
  // -0 would be stored as 0 anyway
  return milli || 0;
}

/**
 * The fixings of a report's text. A report with a shape of its own (no day, a day that is no date, a series twice on
 * one day, a rate that is no number or outside −5…20 %, none of the three series anywhere) throws. An empty value, the
 * cell of a day with no fixing, is skipped, and so is a series the app does not use.
 */
export function parseReport(xml: string): FixingRow[] {
  if (!/<Report\b/.test(xml)) throw new ReferenceRatesError("report is no report");
  const opened = xml.match(/<period\b/g)?.length ?? 0;
  const periods = [...xml.matchAll(/<period\b([^>]*)>([\s\S]*?)<\/period>/g)];
  if (periods.length === 0 || periods.length !== opened) throw new ReferenceRatesError("report has no days, or a day is cut short");
  if (periods.length > MAX_PERIODS) throw new ReferenceRatesError("report has too many days");
  const out: FixingRow[] = [];
  const seen = new Set<string>();
  for (const [, attributes, inside] of periods) {
    const day = attribute(attributes!, "value");
    if (day === null || !isIsoDate(day)) throw new ReferenceRatesError("report holds a day that is no date");
    const rateTags = inside!.match(/<rate\b/g)?.length ?? 0;
    const rates = [...inside!.matchAll(/<rate\b([^>]*)>([\s\S]*?)<\/rate>/g)];
    if (rates.length !== rateTags) throw new ReferenceRatesError("report holds a rate that is cut short");
    for (const [, rateAttributes, rateInside] of rates) {
      const reference = SERIES.get(attribute(rateAttributes!, "name") ?? "");
      const intr = /<intr\b([^>]*?)\/>/.exec(rateInside!);
      if (!intr) throw new ReferenceRatesError("report holds a rate with no value cell");
      if (!reference) continue;
      const value = attribute(intr[1]!, "value");
      if (value === null || value === "") continue;
      const key = `${reference} ${day}`;
      if (seen.has(key)) throw new ReferenceRatesError("report holds a rate twice on one day");
      seen.add(key);
      out.push({ reference, day, rateMilli: milliOf(value) });
    }
  }
  if (out.length === 0) throw new ReferenceRatesError("report holds none of the three rates");
  return out;
}

/** The fixings of one report. Fails with a `ReferenceRatesError` that names no more than what went wrong. */
export async function fetchFixings(fetchFn: typeof fetch, report: Report, timeoutMs = 20_000): Promise<FixingRow[]> {
  const url = `${REFERENCE_RATES_URL}?report=/tilastot/markkina-_ja_hallinnolliset_korot/${REPORT_NAMES[report]}&output=xml`;
  let res: Response;
  try {
    // "manual": a redirect is not followed, so the request goes only to this host; the 3xx then fails the ok check below
    res = await fetchFn(url, { headers: { accept: "application/xml, text/xml" }, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
  } catch (err) {
    // fetch says only "TypeError"; the cause code (ENOTFOUND, ECONNREFUSED, a TLS code) tells what to fix
    const code = (err as { cause?: { code?: unknown } }).cause?.code;
    const detail = typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code) ? ` ${code}` : "";
    throw new ReferenceRatesError(`rates not reachable: ${(err as Error).name}${detail}`);
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => {});
    throw new ReferenceRatesError(`rates answered ${res.status}`);
  }
  let text: string | null;
  try {
    text = await readCappedText(res, MAX_BYTES);
  } catch (err) {
    throw new ReferenceRatesError(`rates answer could not be read: ${(err as Error).name}`);
  }
  if (text === null) throw new ReferenceRatesError("rates answer too large");
  return parseReport(text);
}
