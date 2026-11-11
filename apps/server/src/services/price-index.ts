/**
 * The published consumer price index (Statistics Finland, table 11xs), kept once for the whole instance. Off by default:
 * an admin turns it on under Asetukset > Palvelin, and only then does the server ask. The request names the public
 * series and carries nothing of the household. The hourly tick refreshes it at most once a day; a failure is logged and
 * the series already stored stays. Read for each request (`requestInputs`) and handed to core as a parameter, so a
 * change needs no data version bump. With the setting off no series is read, even when one is stored.
 */
import type { PriceIndex } from "@banking/core";
import { fetchPriceIndex } from "../providers/statfin/client.ts";
import type { Services } from "./context.ts";

const KEY = "instance_price_index";

/** The stored series, checked again as it is read; a row edited into something else is no series. */
function parse(raw: string | null): PriceIndex | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<PriceIndex>;
    if (typeof j.source !== "string" || typeof j.table !== "string" || typeof j.fetchedAt !== "string" || typeof j.months !== "object" || j.months === null) return null;
    const months: Record<string, number> = {};
    for (const [m, v] of Object.entries(j.months)) if (/^\d{4}-\d{2}$/.test(m) && typeof v === "number" && Number.isFinite(v) && v > 0) months[m] = v;
    return { source: j.source, table: j.table, fetchedAt: j.fetchedAt, months };
  } catch {
    return null;
  }
}

/** What a request hands to core: the stored series while the setting is on, else none. */
export async function priceIndexInput(s: Services): Promise<PriceIndex | null> {
  if (!(await s.instance.load()).priceIndex) return null;
  return parse(await s.settings.get(KEY));
}

type PriceIndexRefresh = "off" | "fresh" | "fetched" | "failed";

/** Fetches the series when the setting is on and the stored one is not from today. */
export async function refreshPriceIndex(s: Services): Promise<PriceIndexRefresh> {
  if (!(await s.instance.load(true)).priceIndex) return "off";
  const today = s.today();
  if (parse(await s.settings.get(KEY))?.fetchedAt === today) return "fresh";
  try {
    const series = await fetchPriceIndex(s.fetch ?? fetch, today);
    await s.settings.set(KEY, JSON.stringify(series));
    return "fetched";
  } catch (err) {
    console.error("price index fetch failed:", (err as Error).message);
    return "failed";
  }
}

/** Starts a fetch without waiting for the tick, when an admin turns the setting on. */
export function startPriceIndex(s: Services): void {
  void refreshPriceIndex(s).catch((err) => console.error("price index fetch failed:", err));
}
