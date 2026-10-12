import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../api.ts";

/**
 * Reads a JSON route again and again: soon while the answer says something is under way (`nextDelay` picks the wait
 * from the last answer), slowly otherwise. A failing fetch (the app restarts) backs off, up to a minute. `stopOn`
 * names the refusals that will not get better by asking again (a 403): the poll then ends. `set` takes an answer a
 * change returned and schedules the next read from it, so a page that changes something does not wait for the timer.
 */
export function usePolled<T>(path: string, nextDelay: (data: T) => number, stopOn?: (status: number) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [downSince, setDownSince] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const failures = useRef(0);
  const alive = useRef(true);
  // an answer that arrives after a newer request started is dropped, so an old read cannot undo a change
  const latest = useRef(0);
  const delayOf = useRef(nextDelay);
  const stopWhen = useRef(stopOn);
  delayOf.current = nextDelay;
  stopWhen.current = stopOn;

  const load = useCallback(async () => {
    clearTimeout(timer.current);
    const mine = ++latest.current;
    let delay: number;
    try {
      const d = await api<T>(path);
      if (!alive.current || mine !== latest.current) return;
      failures.current = 0;
      setDownSince(null);
      setError(null);
      setErrorStatus(null);
      setData(d);
      delay = delayOf.current(d);
    } catch (err) {
      if (!alive.current || mine !== latest.current) return;
      failures.current += 1;
      setDownSince((t) => t ?? Date.now());
      setError((err as Error).message);
      const status = err instanceof ApiError ? err.status : 0;
      setErrorStatus(status);
      if (stopWhen.current?.(status)) return;
      // a refused request (403, 401) will not get better by asking faster
      delay = Math.min(3000 * 1.6 ** failures.current, 60_000);
    }
    timer.current = setTimeout(() => void load(), delay);
  }, [path]);

  const set = useCallback(
    (d: T) => {
      clearTimeout(timer.current);
      latest.current += 1;
      failures.current = 0;
      setDownSince(null);
      setError(null);
      setErrorStatus(null);
      setData(d);
      timer.current = setTimeout(() => void load(), delayOf.current(d));
    },
    [load],
  );

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, [load]);

  return { data, error, errorStatus, downSince, reload: load, set };
}
