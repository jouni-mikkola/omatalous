/**
 * Cloudflare API v4 (https://developers.cloudflare.com/api/): the one place that sends the API token.
 *
 * `cloudflare up` runs in a throwaway container with no database, so this is a small HTTP layer and nothing more.
 * An answer is untrusted outside data: its size is capped, a redirect is never followed (the token goes only to
 * api.cloudflare.com), and a failure becomes a `CloudflareError` whose message never holds the token or the
 * request body. Tests replace `fetch`; nothing here reaches the network on its own.
 */

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

const MAX_BYTES = 5_000_000;

export interface Fault {
  code: number;
  message: string;
}

export interface ResultInfo {
  totalPages: number | null;
  totalCount: number | null;
  perPage: number | null;
}

/**
 * `status` is the HTTP status, 0 when Cloudflare could not be reached and 200 when its answer was not what the API
 * describes. `message` is for people and says which permission a 403 means.
 */
export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly faults: Fault[] = [],
  ) {
    super(message);
  }
}

export interface CallOptions {
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  /** The token permission this call needs, named in the message when Cloudflare answers 403. */
  needs?: string;
}

export interface Answer {
  result: unknown;
  info: ResultInfo | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Cloudflare's own words for what went wrong: a few short, printable faults. */
function parseFaults(body: unknown): Fault[] {
  const raw = isObject(body) && Array.isArray(body.errors) ? body.errors : [];
  const faults: Fault[] = [];
  for (const e of raw.slice(0, 5)) {
    if (!isObject(e)) continue;
    const message = typeof e.message === "string" ? e.message.replace(/[^\x20-\x7e]/g, " ").trim().slice(0, 200) : "";
    faults.push({ code: count(e.code) ?? 0, message });
  }
  return faults;
}

const faultText = (faults: Fault[]): string => faults.map((f) => (f.message ? `${f.message} (code ${f.code})` : `code ${f.code}`)).join("; ");

export class CloudflareClient {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  /** `what` is a verb phrase for the messages: "create the tunnel". */
  async call(what: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, opts: CallOptions = {}): Promise<Answer> {
    const query = opts.query ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]): [string, string] => [k, String(v)]))}` : "";
    const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${this.token}` };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchFn(`${CLOUDFLARE_API}${path}${query}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.timeoutMs),
        // "manual": a redirect is not followed, so the token is never sent anywhere else; the 3xx then fails the check below
        redirect: "manual",
      });
    } catch (err) {
      // fetch says only "TypeError"; the cause code (ENOTFOUND, ECONNREFUSED, a TLS code) tells what to fix
      const code = (err as { cause?: { code?: unknown } }).cause?.code;
      const detail = typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code) ? ` ${code}` : "";
      throw new CloudflareError(`Cloudflare is not reachable while trying to ${what}: ${(err as Error).name}${detail}`, 0);
    }
    const body = await this.readJson(res, what);
    const faults = parseFaults(body);
    const success = isObject(body) && body.success === true;
    if (res.ok && success) {
      const info = isObject(body.result_info) ? body.result_info : null;
      return { result: body.result, info: info ? { totalPages: count(info.total_pages), totalCount: count(info.total_count), perPage: count(info.per_page) } : null };
    }
    if (res.status === 401) throw new CloudflareError(`Cloudflare did not accept the API token (HTTP 401) while trying to ${what}. It is wrong, expired or revoked.`, 401, faults);
    if (res.status === 403) {
      const needs = opts.needs ? ` The API token needs the permission "${opts.needs}".` : "";
      throw new CloudflareError(`Cloudflare refused to ${what} (HTTP 403).${needs}`, 403, faults);
    }
    const detail = faults.length ? `: ${faultText(faults)}` : "";
    throw new CloudflareError(`Cloudflare could not ${what} (HTTP ${res.status})${detail}`, res.ok ? 200 : res.status, faults);
  }

  /** The body as JSON, or null when it is empty or not JSON (the status then decides). Cut off beyond MAX_BYTES. */
  private async readJson(res: Response, what: string): Promise<unknown> {
    if (Number(res.headers.get("content-length")) > MAX_BYTES) throw new CloudflareError(`Cloudflare's answer was too large while trying to ${what}`, 200);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new CloudflareError(`Cloudflare's answer was too large while trying to ${what}`, 200);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
}
