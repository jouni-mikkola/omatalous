/**
 * Modules a build adds to the server from outside the shared code. The shared build leaves the list empty; a build of
 * its own fills it from an entry that then imports entry/node.ts. Each part below is read where the shared code does the
 * same thing for itself, so an extension needs no line of its own anywhere else.
 */
import type { FeatureDef, RowParts } from "@banking/core";
import type { Hono } from "hono";
import type { StoredTransaction } from "./db/rows.ts";
import type { Db, Statement } from "./db/types.ts";
import type { AppEnv, Services } from "./services/context.ts";
import type { ExportStore } from "./services/data-export-stores.ts";
import type { ImportStore } from "./services/data-import-stores.ts";

/** A value an extension keeps sealed, re-sealed by the secret rotation in the same transaction as every other. */
export interface ExtensionSealed {
  /** What it was sealed under. */
  context: string;
  sealed: string;
  /** The statement that stores the value sealed again. */
  reseal(sealed: string): Statement;
}

/**
 * The flag ids of the build's extensions, so a flag name is checked like core's: empty here, and a module adds its id with
 * `declare module "<path>/extensions.ts" { interface ExtensionFlags { <id>: true } }`.
 */
export interface ExtensionFlags {}

/** A bank row as an extension reads it to add to it. */
type ExtensionRow = Pick<StoredTransaction, "id" | "accountId" | "bookingDate" | "amountCents" | "merchant" | "category" | "categorySource">;

interface ServerExtension {
  /** Its flag, its route prefix (/api/<id>) and its name in errors; stored in the flag overrides, so never renamed. */
  readonly id: keyof ExtensionFlags & string;
  readonly feature: FeatureDef;
  /** Mounted at /api/<id> behind its flag. */
  routes(s: Services): Hono<AppEnv>;
  /**
   * True when every GET under /api/<id> writes nothing, so a service token may read them all (service-tokens.ts). Left
   * out, its routes stay shut to tokens, like a shared route READABLE does not name.
   */
  readonly tokenReads?: boolean;
  /** A folder of NNNN_name.sql files numbered 9001 to 9899 (9900 on are the CI drills'), each additive with a compat floor. */
  readonly migrationsDir?: string;
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
  /** Removes its demo rows with the shared ones (DELETE /api/demo), whatever its flag says, so none stay behind. */
  removeDemo?(s: Services, userId: string): Promise<void>;
  /**
   * A command of the CLI under its id (`node dist/node.js <id> ...`, cli.ts): the arguments after the id in, the lines to
   * print and the exit code out. The shared CLI prints them, so what the extension keeps out of its own logs stays out.
   */
  cli?(s: Services, args: string[]): Promise<{ code: number; lines: string[] }>;
  /** Its commands as the usage line names them, e.g. "<id> parse | <id> diagnose". */
  readonly cliUsage?: string;
  /** Called by the hourly tick while its flag is on. A failure is logged and ends nothing else. */
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
 * What the extensions whose flag is on add to these rows. A failure is logged and adds nothing: the list of rows is the
 * bank's and shows without them.
 */
export async function extensionRowFields(s: Services, userId: string, rows: readonly ExtensionRow[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (rows.length === 0) return out;
  for (const e of EXTENSIONS) {
    if (!e.rowFields || !s.instance.enabled(e.id)) continue;
    try {
      for (const [id, fields] of await e.rowFields(s, userId, rows)) out.set(id, { ...out.get(id), ...fields });
    } catch (err) {
      console.error(`row fields of ${e.id} failed:`, (err as Error).name);
    }
  }
  return out;
}

/** The extensions whose flag is on that tell rows' parts, each with its stamp: what a cached analysis context was built with. */
export async function rowPartsKey(s: Services, userId: string): Promise<string> {
  const on = EXTENSIONS.filter((e) => e.rowParts && s.instance.enabled(e.id));
  return (await Promise.all(on.map(async (e) => `${e.id}:${await e.rowParts!.stamp(s, userId)}`))).join(",");
}

/**
 * The parts the extensions whose flag is on tell of these rows. A failure is logged and tells nothing: each category is
 * then one figure, as in the shared build.
 */
export async function extensionRowParts(s: Services, userId: string, rows: readonly ExtensionRow[]): Promise<Map<string, RowParts> | undefined> {
  let out: Map<string, RowParts> | undefined;
  if (rows.length === 0) return out;
  for (const e of EXTENSIONS) {
    if (!e.rowParts || !s.instance.enabled(e.id)) continue;
    try {
      for (const [id, parts] of await e.rowParts.parts(s, userId, rows)) (out ??= new Map()).set(id, parts);
    } catch (err) {
      console.error(`row parts of ${e.id} failed:`, (err as Error).name);
    }
  }
  return out;
}
