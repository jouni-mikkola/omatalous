import { createContext, type RefObject, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import type { Meta } from "./types.ts";
import { hashOf, parseHash, type Route, redirectRoute } from "./routes.ts";

/**
 * Fetches JSON and keeps the previous data while a new request is in flight,
 * so charts hold their frame (dimmed) instead of flashing empty.
 */
export function useApi<T>(path: string | null): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
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

/** Minimal hash router: "#/transactions?category=x" → { page, params }. The role decides where the old security address goes. */
export function useHashRoute(role: "admin" | "member"): Route {
  const read = (): Route => {
    const route = parseHash(window.location.hash);
    const moved = redirectRoute(route, role);
    if (!moved) return route;
    // replaceState fires no hashchange and leaves no old entry for Back
    window.history.replaceState(null, "", hashOf(moved));
    return moved;
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(page: string, params: Record<string, string | undefined> = {}): void {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  window.location.hash = `#/${page}${q ? `?${q}` : ""}`;
}

/** What App fetched from /api/meta, once per load: Notices and Why read it here instead of asking again. Null until the answer is there. */
export const MetaContext = createContext<Meta | null>(null);

export const useMeta = (): Meta | null => useContext(MetaContext);
