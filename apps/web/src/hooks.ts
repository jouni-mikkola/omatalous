import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createContext, type RefObject, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api.ts";
import { META_PATH, queryClient } from "./query-client.ts";
import type { Meta } from "./types.ts";
import { hashOf, parseHash, type Route, withParams } from "./routes.ts";

/**
 * Fetches JSON through the shared cache (query-client.ts): the key is the path, so two components that ask for the same
 * path share one request and one answer. While a new path loads the previous data stays (charts hold their frame,
 * dimmed, instead of flashing empty). `keep` is for what Yhteenveto and the shell read: the answer stays on the device for
 * when the server cannot be reached (offline.ts). `reload` asks again whatever the age of the answer.
 */
export function useApi<T>(path: string | null, keep = false): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const answer = useQuery<T, Error>(
    {
      queryKey: [path],
      queryFn: () => api<T>(path!, { keep }),
      enabled: path !== null,
      placeholderData: keepPreviousData,
    },
    queryClient,
  );
  const reload = useCallback(() => {
    if (path) void queryClient.invalidateQueries({ queryKey: [path], exact: true });
  }, [path]);
  return { data: answer.data ?? null, error: answer.error?.message ?? null, loading: answer.isFetching, reload };
}

/** A reload that failed while the page still shows the answer before it: what the server said, and when that answer came. */
export interface Fault {
  message: string;
  /** The time of the answer the page still shows (an ISO time). */
  at: string;
}

/** The fault with the request it belongs to, for the retry. */
type FaultOf = Fault & { path: string };

let shownFault: FaultOf | null = null;

/**
 * The fault of the open page, or null: a request a mounted component reads whose last load failed and whose answer before
 * it is still shown. With several the one with the oldest answer is told, as the figures are at least that old. The
 * shell's own request (`/api/meta`) is not counted: the shell says that itself. A request with no answer is not one
 * either: its page shows the failure in place of the answer (ErrorCard).
 */
function faultNow(): FaultOf | null {
  let found: FaultOf | null = null;
  for (const q of queryClient.getQueryCache().getAll()) {
    const path = q.queryKey[0];
    const { status, data, error, dataUpdatedAt } = q.state;
    if (typeof path !== "string" || path === META_PATH || status !== "error" || data === undefined || !q.getObserversCount()) continue;
    const at = new Date(dataUpdatedAt).toISOString();
    if (!found || at < found.at) found = { path, message: (error as Error | null)?.message ?? "", at };
  }
  // the same fault is the same object, so a reader is drawn again only when it changes
  if (found?.path !== shownFault?.path || found?.at !== shownFault?.at || found?.message !== shownFault?.message) shownFault = found;
  return shownFault;
}

/** The fault of the open page (`Fault`), and `retry` that asks again for the request that failed. */
export function useFault(): { fault: Fault | null; retry: () => void } {
  const fault = useSyncExternalStore((l) => queryClient.getQueryCache().subscribe(l), faultNow);
  const retry = useCallback(() => {
    if (fault) void queryClient.invalidateQueries({ queryKey: [fault.path], exact: true });
  }, [fault]);
  return { fault, retry };
}

/** Width of an element, tracked with ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * The open address as a route: "#/transactions?category=x" gives { page, params }, read again when it changes. The
 * router (router.tsx) has already moved an old address by the time a page reads this; the shell hands the pages their
 * parameters, and this is for a component that reads the address on its own (Asetukset > Lainat).
 */
export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/**
 * Goes to a page with `params` as its parameters. With `keep` the open address's other parameters stay (a period
 * switch on Raportit keeps `tab`); an empty value removes its parameter. The anchor never stays.
 */
export function navigate(page: string, params: Record<string, string | undefined> = {}, keep = false): void {
  const open = parseHash(window.location.hash);
  const base = keep && open.page === page ? open.params : new URLSearchParams();
  window.location.hash = hashOf({ page, params: withParams(base, params) });
}

/** What App fetched from /api/meta, once per load: Notices and Why read it here instead of asking again. Null until the answer is there. */
export const MetaContext = createContext<Meta | null>(null);

export const useMeta = (): Meta | null => useContext(MetaContext);
