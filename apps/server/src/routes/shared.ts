import { isReportId, REPORTS, type ReportId } from "@banking/core";
import type { Context } from "hono";
import { clientIp } from "../auth/middleware.ts";
import { UserError } from "../platform/errors.ts";
import { parseDateRange } from "../platform/validate.ts";
import type { Services } from "../services/context.ts";
import type { RequestInfo } from "../services/users.ts";

/**
 * Where a request came from, for the security event and the service that records it: the address as the limiters count
 * it (auth/middleware.ts `clientIp`) and the browser. Every route that passes a request on builds it here.
 */
export function requestInfo(c: Context, s: Services): RequestInfo {
  return { ip: clientIp(c, s), userAgent: c.req.header("user-agent") ?? null };
}

/** `?from=&to=` with the current month as default. */
export function parseRange(c: Context, today: string): { from: string; to: string } {
  return parseDateRange(c.req.query("from") ?? `${today.slice(0, 7)}-01`, c.req.query("to") ?? today);
}

/** `?reports=a,b`: the core reports a page shows, each a key of the registry; none means every report. */
export function parseReportIds(value: string | undefined): ReportId[] {
  if (!value) return [];
  // a list over the registry's size is refused: split's own limit dropped the rest silently and hid reports from Raportit
  const ids = value.split(",");
  if (ids.length > Object.keys(REPORTS).length || !ids.every(isReportId)) throw UserError.of("check.report");
  return [...new Set(ids)];
}

/** A JSON object body or a 400 with a readable message (never a 500 for bad input). */
export async function body<T>(c: Context): Promise<T> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw UserError.of("check.json");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw UserError.of("check.body_shape");
  return value as T;
}

/** Optional string field: undefined when absent, a 400 when it is something else. */
export function optionalString(value: unknown, max = 200): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > max) throw UserError.of("check.field_bad");
  return value;
}

/** Non-negative integer from a query string, or undefined. */
export function queryInt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw UserError.of("check.number");
  return n;
}

export { csv, csvBody } from "@banking/core";

export function csvResponse(c: Context, filename: string, content: string): Response {
  return c.body(content, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
  });
}

export const cents = (v: number) => Math.round(v) / 100;
