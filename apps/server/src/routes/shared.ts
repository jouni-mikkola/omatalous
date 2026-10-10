import type { Context } from "hono";
import { UserError } from "../services/errors.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `?from=&to=` with the current month as default. */
export function parseRange(c: Context, today: string): { from: string; to: string } {
  const from = c.req.query("from") ?? `${today.slice(0, 7)}-01`;
  const to = c.req.query("to") ?? today;
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) throw new UserError("Virheellinen aikaväli.");
  return { from, to };
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
