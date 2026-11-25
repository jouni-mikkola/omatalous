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
import type { Notice } from "./services/security.ts";

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

/**
 * A question a module puts in Tarkistettavat. Each choice is an answer the page sends to a route under /api, or a link to
 * a page of the app (`href`). `cents` is the money at stake over a year, 0 when none; `guess` is the id of the choice the
 * module suggests.
 */
export interface ExtensionQuestion {
  /** Stable while the question stands; given the module's id in front (`<id>:<question id>`). */
  id: string;
  /** The module's own name for the kind of question. */
  type: string;
  title: string;
  question: string;
  detail?: string;
  date?: string;
  guess?: string;
  cents?: number;
  choices: ExtensionChoice[];
}

type ExtensionChoice = { id: string; label: string } & ({ answer: { method: "PUT" | "POST"; path: `/api/${string}`; body: unknown } } | { href: `#/${string}` });

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
  /**
   * Tokens of its own that a device sends as `Authorization: Bearer <prefix>…` (auth/middleware.ts). Such a request is
   * answered by the token alone and reaches only /api/<id>/device/ and below, as the user `resolve` names, with a member's
   * rights; every other path is 403. A token `resolve` does not open is 401 and counts toward the limit of wrong service
   * tokens. The module makes, stores, ends and removes its tokens itself. `prefix` is 2 to 8 lowercase letters and an
   * underscore, never the service tokens' `omt_` (service-tokens.ts `devicePrefixValid`).
   */
  readonly deviceTokens?: {
    readonly prefix: string;
    resolve(s: Services, token: string): Promise<{ userId: string } | null>;
  };
  /**
   * Its notices of now for the user, in the list of `GET /api/security/notices` after the app's own. Each id is given
   * the module's id in front (`<id>:<notice id>`). A failure is logged and adds none.
   */
  notices?(s: Services, user: { id: string; role: string }): Promise<Notice[]>;
  /**
   * Its questions of now for the user, in Tarkistettavat after the app's own. A question goes when it is no longer returned
   * here. A failure is logged and adds none.
   */
  reviewQuestions?(s: Services, user: { id: string; role: string }): Promise<ExtensionQuestion[]>;
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

/** The notices the modules have for the user. A failure is logged and adds none: the app's own notices show without them. */
export async function extensionNotices(s: Services, user: { id: string; role: string }): Promise<Notice[]> {
  const out: Notice[] = [];
  for (const e of EXTENSIONS) {
    if (!e.notices) continue;
    try {
      for (const n of await e.notices(s, user)) out.push({ ...n, id: `${e.id}:${n.id}` });
    } catch (err) {
      console.error(`notices of ${e.id} failed:`, (err as Error).name);
    }
  }
  return out;
}

const ANSWER_PATH_CHARS = /^[A-Za-z0-9_.~:-]+$/;
const APP_LINK = /^#\/[a-z][a-z0-9-]*(\/[a-z0-9-]+)*(\?[A-Za-z0-9=&_.:-]*)?$/;
const QUESTION_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const MAX_ANSWER_BODY = 4000;

/**
 * Whether a module may send the page to this choice. An answer goes only to a route under the module's own /api/<id>/
 * (letters, digits and `_.~:-` in each segment: no `..`, empty segment, query, escape or backslash) with PUT or POST and a
 * small JSON body. A link goes only to a page of the app (`#/page`, no `//`), never an address outside it.
 */
function choiceAllowed(extensionId: string, c: ExtensionChoice): boolean {
  if (typeof c.id !== "string" || typeof c.label !== "string" || !c.id || !c.label) return false;
  if ("href" in c) return typeof c.href === "string" && APP_LINK.test(c.href);
  const a = c.answer;
  if (a?.method !== "PUT" && a?.method !== "POST") return false;
  const prefix = `/api/${extensionId}/`;
  if (typeof a.path !== "string" || !a.path.startsWith(prefix)) return false;
  const segments = a.path.slice(prefix.length).split("/");
  if (!segments.every((seg) => seg !== "." && seg !== ".." && ANSWER_PATH_CHARS.test(seg))) return false;
  try {
    return (JSON.stringify(a.body ?? null)?.length ?? Infinity) <= MAX_ANSWER_BODY;
  } catch {
    return false;
  }
}

/** The questions the modules have for the user. A failure is logged and adds none: the app's own questions show without them. A choice outside what `choiceAllowed` lets through is left out, and a question left with no choice goes with it. */
export async function extensionQuestions(s: Services, user: { id: string; role: string }): Promise<ExtensionQuestion[]> {
  const out: ExtensionQuestion[] = [];
  for (const e of EXTENSIONS) {
    if (!e.reviewQuestions) continue;
    try {
      for (const q of await e.reviewQuestions(s, user)) {
        if (!QUESTION_ID.test(q.id)) continue;
        const choices = q.choices.filter((c) => choiceAllowed(e.id, c));
        if (choices.length > 0) out.push({ ...q, id: `${e.id}:${q.id}`, choices });
      }
    } catch (err) {
      console.error(`review questions of ${e.id} failed:`, (err as Error).name);
    }
  }
  return out;
}

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
