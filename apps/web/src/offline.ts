import { useSyncExternalStore } from "react";
import { timeZone } from "./format.ts";

/**
 * The figures that stay on the device so Yhteenveto opens when the server cannot be reached: the last answer of each
 * request a page marks `keep` (see `api` in api.ts), the time it was fetched, and who is signed in. They are kept in a
 * cache of their own for one user at a time: a different user, a logout and a lost session each empty it. The service
 * worker (sw.js) never touches /api/, so nothing financial is in its cache. A browser with no Cache API (a page that is
 * not https and not localhost) keeps nothing and opens nothing offline.
 */
const STORE = "omatalous-figures";
const OWNER = "/figures/owner";
const AUTH = "/api/auth/state";
const SAVED_AT = "X-Saved-At";

const here = (path: string) => new Request(new URL(path, location.origin));

/**
 * Writes and wipes go one after another, here and across every tab of the browser (a Web Lock), since the store is shared
 * and "is it still this user's" must be asked and answered with no other tab's wipe or sign-in in between.
 */
const LOCK = "omatalous-figures";
let queue: Promise<unknown> = Promise.resolve();
const later = <T>(job: () => Promise<T>): Promise<T | undefined> => {
  const locked = async (): Promise<T> => (typeof navigator !== "undefined" && navigator.locks ? await navigator.locks.request(LOCK, job) : await job());
  const run = queue.then(locked, locked);
  queue = run.catch(() => undefined);
  return run.catch(() => undefined);
};

/** Who is signed in, as this tab knows it. Not the truth about the store: another tab may have signed someone else in, so a write asks the store's own owner. */
let owner: string | null = null;
export const figuresOwner = (): string | null => owner;

/**
 * Counts the changes of whose figures the store holds, in every tab (a counter in localStorage, no figures): a new owner
 * and a wipe each add one. A request that names the user (the answer to "who is signed in") takes the count before it
 * is sent, and its answer is a ticket: one older than the count, from before a logout or another user's sign-in in any
 * tab, is no longer the truth about the browser and may not become the owner again.
 */
const EPOCH = "omatalous-figures-epoch";
const epoch = (): number => {
  try {
    return Number(localStorage.getItem(EPOCH)) || 0;
  } catch {
    return 0;
  }
};
const bump = (): void => {
  try {
    localStorage.setItem(EPOCH, String(epoch() + 1));
  } catch {
    // no localStorage: tickets are then always equal, and the stored owner is the only check
  }
};
export const figuresTicket = epoch;

/**
 * Called with every answer to "who is signed in", with the ticket taken before the request was sent (now, for an answer
 * the user caused). A user other than the stored one empties the store; no user empties it too. An answer older than the
 * last change of owner counts only for the user the store already holds: it can refresh their entry, never restore one.
 */
export function holdFiguresFor(user: { id: string } | null, ticket: number = epoch()): void {
  owner = user?.id ?? null;
  if (!user) return void forgetFigures();
  void later(async () => {
    if (typeof caches === "undefined") return;
    const held = (await caches.has(STORE)) ? await (await (await caches.open(STORE)).match(here(OWNER)))?.text() : undefined;
    if (ticket !== epoch() && held !== user.id) return;
    if (held !== user.id) {
      await caches.delete(STORE);
      bump();
    }
    const store = await caches.open(STORE);
    if (held !== user.id) await store.put(here(OWNER), new Response(user.id));
    // the answer to "who is signed in" is the user's own, so it is written here, not by the request
    await store.put(here(AUTH), new Response(JSON.stringify({ needsSetup: false, user, timezone: timeZone() }), { headers: { [SAVED_AT]: new Date().toISOString() } }));
  });
}

/** Empties the store: logout, a lost session. */
export function forgetFigures(): Promise<void> {
  owner = null;
  setStale(new Map());
  return later(async () => {
    if (typeof caches !== "undefined") await caches.delete(STORE);
    bump();
  }) as Promise<void>;
}

/** Keeps the answer to a request of `who`, if the page still has that user. */
export function keepFigures(path: string, body: unknown, who: string | null): void {
  if (!who || who !== owner) return;
  void later(async () => {
    if (typeof caches === "undefined" || who !== owner || !(await caches.has(STORE))) return;
    const store = await caches.open(STORE);
    // only the user the store was made for: an answer that came late, after a logout or another user's sign-in in any tab, is dropped
    if ((await (await store.match(here(OWNER)))?.text()) !== who) return;
    await store.put(here(path), new Response(JSON.stringify(body), { headers: { [SAVED_AT]: new Date().toISOString() } }));
  });
}

/** The kept answer to a request, and the time it was fetched; null when there is none. */
export async function keptFigures(path: string): Promise<{ data: unknown; at: string } | null> {
  if (typeof caches === "undefined" || !(await caches.has(STORE))) return null;
  const hit = await (await caches.open(STORE)).match(here(path));
  if (!hit) return null;
  return { data: await hit.json(), at: hit.headers.get(SAVED_AT) ?? "" };
}

/** The kept answers the page shows now, by request; the oldest time is the time of the figures. */
let stale = new Map<string, string>();
const listeners = new Set<() => void>();
function setStale(next: Map<string, string>): void {
  stale = next;
  for (const l of listeners) l();
}
/** A request was answered from the store. The answer to "who is signed in" is not counted: it carries no figures. */
export function markKept(path: string, at: string): void {
  if (path !== AUTH) setStale(new Map(stale).set(path, at));
}
/** A request was answered by the server: what the page shows for it is current. */
export function markCurrent(path: string): void {
  if (!stale.has(path)) return;
  const next = new Map(stale);
  next.delete(path);
  setStale(next);
}
/** The page asks for everything again: what is still unreachable marks itself again. */
export const markAllCurrent = (): void => setStale(new Map());

/** The time of the oldest answer the page shows from the store (an ISO time), or null when every figure is from the server. */
function oldest(): string | null {
  let at: string | null = null;
  for (const t of stale.values()) if (at === null || t < at) at = t;
  return at;
}
export function useFiguresFrom(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    oldest,
  );
}
