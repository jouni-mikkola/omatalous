/**
 * What an add-on module adds to the server (docs/MODULES.md). The list is empty unless the owner entered a code and a
 * signed bundle was loaded at start (services/modules/load.ts). Each part below is read where the shared code does the
 * same thing for itself, so a module needs no line of its own anywhere else. A registered module is on: the code is the
 * switch.
 */
import type { CategoryRowParts as RowParts } from "@banking/core";
import type { Hono } from "hono";
import type { StoredTransaction } from "./db/rows.ts";
import type { Db, Statement } from "./db/types.ts";
import type { AppEnv, Services } from "./services/context.ts";
import type { ExportStore } from "./db/data-export-stores.ts";
import type { ImportStore } from "./services/data-import-stores.ts";

/** A value a module keeps sealed, re-sealed by the secret rotation in the same transaction as every other. */
export interface ExtensionSealed {
  /** What it was sealed under. */
  context: string;
  sealed: string;
  /** The statement that stores the value sealed again. */
  reseal(sealed: string): Statement;
}

/** A bank row as a module reads it to add to it. */
type ExtensionRow = Pick<StoredTransaction, "id" | "accountId" | "bookingDate" | "amountCents" | "merchant" | "category" | "categorySource">;

export interface ServerExtension {
  /** Its route prefix (/api/<id>), its page id and its name in errors; the manifest's id, never renamed. */
  readonly id: string;
  /** Its name for the admin. */
  readonly label?: string;
  /** Mounted at /api/<id>, behind the signed-in user. */
  routes(s: Services): Hono<AppEnv>;
  /**
   * True when every GET under /api/<id> writes nothing, so a service token may read them all (service-tokens.ts). Left
   * out, its routes stay shut to tokens, like a shared route READABLE does not name.
   */
  readonly tokenReads?: boolean;
  /** Set by the loader from the manifest: a folder of NNNN_name.sql files numbered 9001 to 9899, each additive with a compat floor. */
  migrationsDir?: string;
  /** Its tables the household's export holds: how each is written and how an import reads it back. */
  readonly stores?: readonly { readonly export: ExportStore; readonly import: ImportStore }[];
  /** Its tables the household's export leaves out, with the reason (data-export-stores.ts LEFT_OUT). */
  readonly leftOut?: Readonly<Record<string, string>>;
  /** Its sealed values, for the secret rotation. */
  sealed?(db: Db): Promise<ExtensionSealed[]>;
  /** The security event kinds it records. */
  readonly securityEvents?: readonly string[];
  /** Loads its own demo rows for the user beside the shared demo data (demo.ts), replacing those it loaded before. */
  demo?(s: Services, userId: string, today: string): Promise<void>;
  /** Removes its demo rows with the shared ones (DELETE /api/demo). */
  removeDemo?(s: Services, userId: string): Promise<void>;
  /**
   * A command of the CLI under its id (`node dist/node.js <id> ...`, cli.ts): the arguments after the id in, the lines to
   * print and the exit code out. The shared CLI prints them, so what the module keeps out of its own logs stays out.
   */
  cli?(s: Services, args: string[]): Promise<{ code: number; lines: string[] }>;
  /** Its commands as the usage line names them, e.g. "<id> parse". */
  readonly cliUsage?: string;
  /** Called by the hourly tick. A failure is logged and ends nothing else. */
  hourly?(s: Services): Promise<void>;
  /**
   * Fields it adds to rows of Tapahtumat, by row id, derived on read and stored nowhere. Given only the viewer's own
   * rows of the page; a row it says nothing of is left as it is.
   */
  rowFields?(s: Services, userId: string, rows: readonly ExtensionRow[]): Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>;
  /**
   * The money of rows a level under their category, by row id, for the reports and Yhteenveto (core `row-parts.ts`), read
   * into the cached analysis context. `parts` is given the viewer's own rows. `stamp` changes whenever what `parts` would
   * tell does with no data version moving (a choice of the household's); the cache entry is built again then.
   */
  readonly rowParts?: {
    stamp(s: Services, userId: string): Promise<string>;
    parts(s: Services, userId: string, rows: readonly ExtensionRow[]): Promise<ReadonlyMap<string, RowParts>>;
  };
}

export const EXTENSIONS: ServerExtension[] = [];

/**
 * What the module adds to these rows. A failure is logged and adds nothing: the list of rows is the bank's and shows
 * without them.
 */
export async function extensionRowFields(s: Services, userId: string, rows: readonly ExtensionRow[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (rows.length === 0) return out;
  for (const e of EXTENSIONS) {
    if (!e.rowFields) continue;
    try {
      for (const [id, fields] of await e.rowFields(s, userId, rows)) out.set(id, { ...out.get(id), ...fields });
    } catch (err) {
      console.error(`row fields of ${e.id} failed:`, (err as Error).name);
    }
  }
  return out;
}

/** The modules that tell rows' parts, each with its stamp: what a cached analysis context was built with. */
export async function rowPartsKey(s: Services, userId: string): Promise<string> {
  const on = EXTENSIONS.filter((e) => e.rowParts);
  return (await Promise.all(on.map(async (e) => `${e.id}:${await e.rowParts!.stamp(s, userId)}`))).join(",");
}

/** The parts the modules tell of these rows. A failure is logged and tells nothing: each category is then one figure. */
export async function extensionRowParts(s: Services, userId: string, rows: readonly ExtensionRow[]): Promise<Map<string, RowParts> | undefined> {
  let out: Map<string, RowParts> | undefined;
  if (rows.length === 0) return out;
  for (const e of EXTENSIONS) {
    if (!e.rowParts) continue;
    try {
      for (const [id, parts] of await e.rowParts.parts(s, userId, rows)) (out ??= new Map()).set(id, parts);
    } catch (err) {
      console.error(`row parts of ${e.id} failed:`, (err as Error).name);
    }
  }
  return out;
}
