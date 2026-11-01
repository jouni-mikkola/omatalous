/**
 * Statistics Finland's consumer price index, the overall index of table 11xs (StatFin, PxWeb API):
 * https://statfin.stat.fi/PxWeb/api/v1/en/StatFin/khi/11xs.px
 *
 * One POST asks for the public series and sends nothing of the household. Variable `contentscode` is the base year of
 * the points; `ip_0_1972` (1972=100) is the one column that has every month and stays current when the base changes,
 * so the app reads ratios of it only. The answer is untrusted outside data: size-limited, and reduced to month and
 * number, each checked, before anything else sees it.
 */
import type { PriceIndex } from "@banking/core";
import { readCappedText } from "../../platform/outbound.ts";

const STATFIN_HOST = "statfin.stat.fi";
const STATFIN_TABLE = "11xs";
const STATFIN_URL = `https://${STATFIN_HOST}/PxWeb/api/v1/en/StatFin/khi/${STATFIN_TABLE}.px`;
const STATFIN_SERIES = "ip_0_1972";
const PRICE_INDEX_SOURCE = "Tilastokeskus";

/** Ten years of months is far more than the comparison reads; the answer for the whole table is about 35 kB. */
const KEEP_MONTHS = 120;
const MAX_BYTES = 1_000_000;

class PriceIndexError extends Error {}

const QUERY = {
  query: [{ code: "contentscode", selection: { filter: "item", values: [STATFIN_SERIES] } }],
  response: { format: "json-stat2" },
};

/** The index points by month from a json-stat2 answer, or null when it is not the table asked for. */
function parsePriceIndex(body: unknown, fetchedAt: string): PriceIndex | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { id?: unknown; size?: unknown; value?: unknown; dimension?: unknown };
  if (!Array.isArray(b.id) || b.id.length !== 2 || b.id[0] !== "timeperiod_m" || b.id[1] !== "contentscode") return null;
  if (!Array.isArray(b.value) || !Array.isArray(b.size) || b.size[1] !== 1 || b.size[0] !== b.value.length) return null;
  const dims = b.dimension as Record<string, { category?: { index?: unknown } }> | undefined;
  const positions = dims?.timeperiod_m?.category?.index;
  const series = dims?.contentscode?.category?.index;
  if (typeof positions !== "object" || positions === null || Array.isArray(positions)) return null;
  if (typeof series !== "object" || series === null || !(STATFIN_SERIES in series)) return null;
  const months: Record<string, number> = {};
  for (const [label, at] of Object.entries(positions as Record<string, unknown>)) {
    const m = /^(\d{4})M(0[1-9]|1[0-2])$/.exec(label);
    const v = typeof at === "number" ? b.value[at] : undefined;
    if (m && typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100_000) months[`${m[1]}-${m[2]}`] = v;
  }
  const keep = Object.keys(months).sort().slice(-KEEP_MONTHS);
  if (keep.length < 24) return null;
  return { source: PRICE_INDEX_SOURCE, table: STATFIN_TABLE, fetchedAt, months: Object.fromEntries(keep.map((m) => [m, months[m]!])) };
}

export async function fetchPriceIndex(fetchFn: typeof fetch, fetchedAt: string, timeoutMs = 20_000): Promise<PriceIndex> {
  let res: Response;
  try {
    // "manual": a redirect is not followed, so the request goes only to Statistics Finland; the 3xx then fails the ok check
    res = await fetchFn(STATFIN_URL, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(QUERY), signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
  } catch (err) {
    const code = (err as { cause?: { code?: unknown } }).cause?.code;
    const detail = typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code) ? ` ${code}` : "";
    throw new PriceIndexError(`price index not reachable: ${(err as Error).name}${detail}`);
  }
  if (!res.ok) throw new PriceIndexError(`price index answered ${res.status}`);
  let text: string | null;
  try {
    text = await readCappedText(res, MAX_BYTES);
  } catch (err) {
    throw new PriceIndexError(`price index answer could not be read: ${(err as Error).name}`);
  }
  if (text === null) throw new PriceIndexError("price index answer too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new PriceIndexError("price index answer is not JSON");
  }
  const parsed = parsePriceIndex(body, fetchedAt);
  if (!parsed) throw new PriceIndexError("price index answer is not the table asked for");
  return parsed;
}
