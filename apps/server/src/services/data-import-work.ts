/** What one plan of "Tuo tiedot" gathers and the checks every part of it shares. */
import { type OwnAccount, ImportRepo } from "../db/import-repo.ts";
import type { Statement } from "../db/types.ts";
import type { Services } from "./context.ts";
import { refuse, type ImportHead, type Row, type Session, type User } from "./data-import-session.ts";
import { IMPORT_BY_KEY, type ImportStore } from "./data-import-stores.ts";

/** Why a row is not added: it is another user's, a kind of row this import never writes, household-wide and the user is not the admin, or a settlement row the user may not bring (`refused`). */
export type SkipReason = "other_user" | "users" | "sharing" | "household" | "refused";

interface StoreCounts {
  key: string;
  add: number;
  exists: number;
  skipped: { reason: SkipReason; n: number }[];
}

/** The answer of a dry run, and of a commit (with `committed`). */
export interface ImportPlan {
  session: string;
  expiresAt: string;
  head: ImportHead;
  stores: StoreCounts[];
  /** The people the file names who are not the signed-in user: their rows are never written. */
  otherUsers: { username: string; rows: number }[];
  /** Stores of the file this import does not know (rows counted), and keys of known rows it does not know (counted). */
  ignored: { stores: { key: string; rows: number }[]; keys: number };
  total: { add: number; exists: number; skipped: number };
  committed: boolean;
}

/** What the route layer lends the import: the loan form's own checks (the services do not import routes). */
export interface ImportChecks {
  loan(fields: Record<string, unknown>, accounts: { getAccount(id: string): Promise<{ id: string; type: string } | null> }): Promise<unknown>;
}

/** What one plan gathers as it goes through the stores: what is written, the counts, and how the file's ids map to the ones here. */
export interface Work {
  s: Services;
  ses: Session;
  me: User;
  repo: ImportRepo;
  statements: Statement[];
  counts: Map<string, StoreCounts>;
  others: Map<string, number>;
  /** The people the file names, username by the file's id. */
  fileUsers: Map<string, string>;
  local: OwnAccount[];
  localById: Map<string, OwnAccount>;
  localKeys: Set<string>;
  accMap: Map<string, string>;
  createdAccounts: Set<string>;
  keyMap: Map<string, string>;
  otherAcc: Map<string, string>;
  otherKey: Map<string, string>;
}

export function workOf(s: Services, ses: Session): Work {
  return {
    s, ses, me: ses.user, repo: new ImportRepo(s.db), statements: [], counts: new Map(), others: new Map(), fileUsers: new Map(),
    local: [], localById: new Map(), localKeys: new Set(), accMap: new Map(), createdAccounts: new Set(), keyMap: new Map(), otherAcc: new Map(), otherKey: new Map(),
  };
}

export const rowsOf = (w: Work, key: string) => w.ses.rows.get(key) ?? [];
export const tally = (w: Work, key: string) => w.counts.get(key) ?? w.counts.set(key, { key, add: 0, exists: 0, skipped: [] }).get(key)!;

export function skip(w: Work, key: string, reason: SkipReason, who?: string): void {
  const t = tally(w, key);
  const r = t.skipped.find((x) => x.reason === reason);
  if (r) r.n++;
  else t.skipped.push({ reason, n: 1 });
  if (who !== undefined) w.others.set(who, (w.others.get(who) ?? 0) + 1);
}

/** The checks of the plan that read the whole file: a reference that points nowhere refuses it. */
export function dangling(s: Services, ses: Session, store: ImportStore, i: number, column: string): never {
  refuse(s, ses, `Tiedoston kohdan ${store.key} rivi ${i + 1} viittaa riviin (${column}), jota tiedostossa tai tässä sovelluksessa ei ole.`);
}

/** The people the file names; the signed-in user is the one whose username is theirs. */
export function readUsers(w: Work): void {
  for (const [i, u] of rowsOf(w, "users").entries()) {
    if (w.fileUsers.has(String(u.id))) dangling(w.s, w.ses, IMPORT_BY_KEY.get("users")!, i, "id");
    w.fileUsers.set(String(u.id), String(u.username));
  }
}

export function usernameOf(w: Work, store: ImportStore, i: number, column: string, fileId: unknown): string {
  const name = w.fileUsers.get(String(fileId));
  return name ?? dangling(w.s, w.ses, store, i, column);
}

/** Whose an account or a transaction of the file is; the name the export wrote beside it must agree. */
export function ownerOf(w: Work, store: ImportStore, i: number, row: Row): string {
  const owner = usernameOf(w, store, i, "user_id", row.user_id);
  if (row["@owner_username"] !== undefined && row["@owner_username"] !== owner) dangling(w.s, w.ses, store, i, "owner_username");
  return owner;
}
