/**
 * Finnish trade register search (PRH / YTJ open data, no key needed):
 * https://avoindata.prh.fi/opendata-ytj-api/v3/companies?name=…
 *
 * Only a merchant name is sent. The answer is untrusted outside data: it
 * is size-limited and reduced to the few fields the app uses, each checked
 * for type and length, before anything else sees it.
 */
import type { IndustryCodeSet, RegistryCompany } from "@banking/core";
import { readCappedText } from "../../platform/outbound.ts";

export const PRH_SEARCH_URL = "https://avoindata.prh.fi/opendata-ytj-api/v3/companies";

const MAX_BYTES = 2_000_000;
/** A safety cap only; a name the register knows that many times is not one merchant anyway. */
const MAX_COMPANIES = 1000;
const CODE_SETS = new Map<string, IndustryCodeSet>([
  ["TOIMI3", "TOL2008"],
  ["TOIMI4", "TOL2025"],
]);

export class RegistryError extends Error {}

const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/** One company from the response, or null when it has no name in use. */
export function parseCompany(raw: unknown): RegistryCompany | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const businessId = str((c.businessId as Record<string, unknown> | undefined)?.value, 20);
  if (!businessId || !/^\d{7}-\d$/.test(businessId)) return null;
  const names = (Array.isArray(c.names) ? c.names : [])
    .slice(0, 40)
    .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null && !n.endDate)
    .map((n) => str(n.name))
    .filter((n): n is string => n !== null);
  if (!names.length) return null;
  const line = c.mainBusinessLine as Record<string, unknown> | undefined;
  const code = str(line?.type, 5);
  const codeSet = CODE_SETS.get(str(line?.typeCodeSet, 10) ?? "");
  const descriptions = Array.isArray(line?.descriptions) ? (line.descriptions as Record<string, unknown>[]) : [];
  const label = str(descriptions.find((d) => d?.languageCode === "1")?.description);
  return {
    businessId,
    names,
    // status 1 is a company in the register's books; the others are not yet, ceasing or ceased
    active: String(c.tradeRegisterStatus) === "1",
    industry: code && /^\d{2,5}$/.test(code) && codeSet ? { code, codeSet, label } : null,
  };
}

export interface SearchResult {
  companies: RegistryCompany[];
  /** False when the register has more hits than it returned (one page): only an exact name is safe to trust then. */
  complete: boolean;
}

export async function searchCompanies(fetchFn: typeof fetch, name: string, timeoutMs = 10_000): Promise<SearchResult> {
  const url = `${PRH_SEARCH_URL}?${new URLSearchParams({ name })}`;
  let res: Response;
  try {
    // "manual": a redirect is not followed, so the name goes only to PRH; the 3xx then fails the ok check below
    res = await fetchFn(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
  } catch (err) {
    // fetch says only "TypeError"; the cause code (ENOTFOUND, ECONNREFUSED, a TLS code) tells what to fix
    const code = (err as { cause?: { code?: unknown } }).cause?.code;
    const detail = typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code) ? ` ${code}` : "";
    throw new RegistryError(`register not reachable: ${(err as Error).name}${detail}`);
  }
  if (res.status === 404) return { companies: [], complete: true };
  if (!res.ok) throw new RegistryError(`register answered ${res.status}`);
  let text: string | null;
  try {
    text = await readCappedText(res, MAX_BYTES);
  } catch (err) {
    throw new RegistryError(`register answer could not be read: ${(err as Error).name}`);
  }
  if (text === null) throw new RegistryError("register answer too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new RegistryError("register answer is not JSON");
  }
  const list = (body as { companies?: unknown })?.companies;
  if (!Array.isArray(list)) throw new RegistryError("register answer has no company list");
  const total = (body as { totalResults?: unknown }).totalResults;
  const companies = list
    .slice(0, MAX_COMPANIES)
    .map(parseCompany)
    .filter((c): c is RegistryCompany => c !== null);
  return { companies, complete: typeof total === "number" && total <= list.length && list.length <= MAX_COMPANIES };
}
