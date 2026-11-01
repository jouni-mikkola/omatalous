import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createContext, type RefObject, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { queryClient } from "./query-client.ts";
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
