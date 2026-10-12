import { isReportId, type ReportId } from "@banking/core";
import type { Context } from "hono";
import { clientIp } from "../auth/middleware.ts";
import { UserError } from "../platform/errors.ts";
import { isIsoDate } from "../platform/validate.ts";
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
  const from = c.req.query("from") ?? `${today.slice(0, 7)}-01`;
  const to = c.req.query("to") ?? today;
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new UserError("Virheellinen aikaväli.");
  return { from, to };
}

/** `?reports=a,b`: the core reports a page shows, each a key of the registry; none means every report. */
export function parseReportIds(value: string | undefined): ReportId[] {
  if (!value) return [];
  const ids = value.split(",", 20);
  if (!ids.every(isReportId)) throw new UserError("Tuntematon raportti.");
  return [...new Set(ids)];
}

/** A JSON object body or a 400 with a readable message (never a 500 for bad input). */
export async function body<T>(c: Context): Promise<T> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new UserError("Pyynnön sisältö ei ole kelvollista JSONia.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UserError("Pyynnön sisältö on väärän muotoinen.");
  return value as T;
}

/** Optional string field: undefined when absent, a 400 when it is something else. */
export function optionalString(value: unknown, max = 200): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > max) throw new UserError("Virheellinen kenttä.");
  return value;
}

/** Non-negative integer from a query string, or undefined. */
export function queryInt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UserError("Virheellinen luku.");
  return n;
}

/**
 * CSV for spreadsheet apps in Finnish locale: semicolon separated, decimal
 * comma, UTF-8 with BOM so Excel detects the encoding.
 */
export function csvBody(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    // formula injection guard: a cell that starts with = + - @, a tab or a CR (also after blanks) is
    // treated as text by spreadsheets
    const safe = typeof v === "string" && /^\s*[=+\-@]|^[\t\r]/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `${rows.map((r) => r.map(cell).join(";")).join("\r\n")}\r\n`;
}

/** The BOM and the rows. A long file is written in pieces with `csvBody` instead, the BOM only once. */
export function csv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return `\ufeff${csvBody(rows)}`;
}

export function csvResponse(c: Context, filename: string, content: string): Response {
  return c.body(content, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
  });
}

export const cents = (v: number) => Math.round(v) / 100;
