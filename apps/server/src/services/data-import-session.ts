/**
 * "Tuo tiedot": the sessions of an import (services/data-import.ts makes the plan). A session holds the rows of the chunks
 * the page sent, each already checked against its store; it belongs to one user, lasts 15 minutes without a chunk, and
 * ends at the commit, at a refusal and on cancel. The file is hostile until proved otherwise: the first failure ends it.
 */
import { UserError } from "../platform/errors.ts";
import { randomToken } from "../platform/ids.ts";
import type { Services } from "./context.ts";
import { BadValue, checkRow, IMPORT_BY_KEY, IMPORT_FORMAT, IMPORT_LIMITS, IMPORT_VERSION } from "./data-import-stores.ts";

export type Row = Record<string, string | number | null>;
export type User = { id: string; username: string; role: string };
export interface ImportHead {
  version: number;
  appVersion: string | null;
  exportedAt: string | null;
}

export interface Session {
  id: string;
  user: User;
  expires: number;
  nextChunk: number;
  bytes: number;
  head: ImportHead;
  rows: Map<string, Row[]>;
  unknownStores: Map<string, number>;
  unknownKeys: number;
}

const sessions = new WeakMap<Services, Map<string, Session>>();
const MAX_SESSIONS = 8;
const MAX_UNKNOWN_STORES = 50;
const GONE = "Tuonti on päättynyt tai vanhentunut. Aloita alusta.";

/** The live sessions: one that has not been used for its time is dropped here, so every call frees an abandoned one. */
export function open(s: Services): Map<string, Session> {
  const all = sessions.get(s) ?? sessions.set(s, new Map()).get(s)!;
  const now = s.now().getTime();
  for (const [id, ses] of all) if (ses.expires < now) all.delete(id);
  return all;
}
export const expiry = (s: Services) => s.now().getTime() + IMPORT_LIMITS.sessionMinutes * 60_000;

/** The user's own live session, else the one sentence for a session that is missing, over or somebody else's. */
export function sessionOf(s: Services, user: { id: string }, id: string): Session {
  const ses = open(s).get(id);
  if (!ses || ses.user.id !== user.id) throw new UserError(GONE);
  return ses;
}

/** Opens a session for the file's head: the format and the version are checked before one byte of data is read. */
export function startImport(s: Services, user: User, head: unknown): { session: string; expiresAt: string; limits: typeof IMPORT_LIMITS } {
  const h = typeof head === "object" && head !== null && !Array.isArray(head) ? (head as Record<string, unknown>) : {};
  if (h.format !== IMPORT_FORMAT) throw new UserError("Tiedosto ei ole Omatalouden tietotiedosto.");
  if (h.version !== IMPORT_VERSION) throw new UserError(`Tiedoston versiota ei voi tuoda. Tämä Omatalous lukee tiedoston version ${IMPORT_VERSION}.`);
  if (h.exportedBy !== undefined && h.exportedBy !== user.username) throw new UserError("Tiedosto on toisen käyttäjän. Tuo vain omat tietosi.");
  const all = open(s);
  for (const [id, ses] of all) if (ses.user.id === user.id) all.delete(id);
  if (all.size >= MAX_SESSIONS) throw new UserError("Tuonteja on käynnissä liian monta. Yritä hetken päästä uudelleen.");
  const text = (v: unknown) => (typeof v === "string" && v.length <= 100 ? v : null);
  const ses: Session = {
    id: randomToken(),
    user,
    expires: expiry(s),
    nextChunk: 0,
    bytes: 0,
    head: { version: IMPORT_VERSION, appVersion: text(h.appVersion), exportedAt: text(h.exportedAt) },
    rows: new Map(),
    unknownStores: new Map(),
    unknownKeys: 0,
  };
  all.set(ses.id, ses);
  return { session: ses.id, expiresAt: new Date(ses.expires).toISOString(), limits: IMPORT_LIMITS };
}

/** Throws the refusal for a store and row, and ends the session: a file that fails once is not read further. */
export function refuse(s: Services, ses: Session, what: string): never {
  open(s).delete(ses.id);
  throw new UserError(`${what} Mitään ei tuotu.`);
}

/**
 * Stages the rows of one chunk: `stores` maps a store's name to its rows. A chunk is the next one in order (`seq`), within
 * the size of a chunk and of the whole file, and every row of a known store passes its checks; a store the import does not
 * know is counted and dropped. The first failure ends the session, so no later chunk lands in it.
 */
export function addChunk(s: Services, user: { id: string }, id: string, seq: unknown, bytes: number, stores: unknown): { staged: number } {
  const ses = sessionOf(s, user, id);
  if (seq !== ses.nextChunk) refuse(s, ses, "Tiedoston osa puuttuu tai on väärässä järjestyksessä.");
  if (bytes > IMPORT_LIMITS.chunkBytes || ses.bytes + bytes > IMPORT_LIMITS.totalBytes || ses.nextChunk >= IMPORT_LIMITS.chunks) refuse(s, ses, "Tiedosto on liian suuri tuotavaksi.");
  if (typeof stores !== "object" || stores === null || Array.isArray(stores)) refuse(s, ses, "Tiedoston osa on väärän muotoinen.");
  let staged = 0;
  for (const [name, rows] of Object.entries(stores)) {
    const store = IMPORT_BY_KEY.get(name);
    if (!store) {
      const shown = name.slice(0, 60);
      if (!ses.unknownStores.has(shown) && ses.unknownStores.size >= MAX_UNKNOWN_STORES) continue;
      ses.unknownStores.set(shown, (ses.unknownStores.get(shown) ?? 0) + (Array.isArray(rows) ? rows.length : 1));
      continue;
    }
    if (!Array.isArray(rows)) refuse(s, ses, `Tiedoston kohta ${name} on väärän muotoinen.`);
    const have = ses.rows.get(name) ?? [];
    const before = have.length;
    if (have.length + rows.length > store.max) refuse(s, ses, `Tiedoston kohdassa ${name} on liikaa rivejä.`);
    rows.forEach((raw, i) => {
      try {
        const { row, unknownKeys } = checkRow(store, raw);
        ses.unknownKeys += unknownKeys;
        have.push(row);
      } catch (err) {
        if (!(err instanceof BadValue)) throw err;
        refuse(s, ses, `Tiedoston kohdan ${name} rivi ${before + i + 1} on virheellinen (${err.message || "rivi"}).`);
      }
    });
    ses.rows.set(name, have);
    staged += rows.length;
  }
  ses.bytes += bytes;
  ses.nextChunk++;
  ses.expires = expiry(s);
  return { staged };
}

/** Ends a session the user no longer wants. */
export function cancelImport(s: Services, user: { id: string }, id: string): void {
  const ses = open(s).get(id);
  if (ses?.user.id === user.id) open(s).delete(id);
}
