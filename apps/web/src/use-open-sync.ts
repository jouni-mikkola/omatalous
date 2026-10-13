import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { type OpenSync, RUNNING_RETRIES, RUNNING_RETRY_MS, shouldAsk } from "./open-sync.ts";

/**
 * Asks the server to fetch rows when the app is opened (and when the tab is shown again), and keeps the answer for
 * the line at the top. While a fetch runs it asks again every few seconds; `onNew` hears of rows that arrived
 * during that wait. A failed or refused call (an older server answers 404) shows nothing and waits for the next visit.
 */
export function useOpenSync(onNew: (inserted: number) => void): OpenSync | null {
  const [answer, setAnswer] = useState<OpenSync | null>(null);
  const heard = useRef(onNew);
  heard.current = onNew;

  useEffect(() => {
    let alive = true;
    let busy = false;
    let lastAsked: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waited = false;
    let tries = 0;

    const ask = async () => {
      if (busy) return;
      busy = true;
      timer = undefined;
      lastAsked = Date.now();
      let next: OpenSync | null = null;
      try {
        next = await api<OpenSync>("/api/sync/open", { method: "POST" });
      } catch {
        next = null;
      }
      busy = false;
      if (!alive) return;
      if (next?.state === "running") {
        waited = true;
        tries += 1;
        if (tries > RUNNING_RETRIES) {
          setAnswer(null);
          waited = false;
          tries = 0;
          return;
        }
        setAnswer(next);
        timer = setTimeout(() => void ask(), RUNNING_RETRY_MS);
        return;
      }
      if (next?.state === "fresh" && waited && next.inserted > 0) heard.current(next.inserted);
      waited = false;
      tries = 0;
      setAnswer(next);
    };

    const visible = () => {
      if (document.visibilityState !== "visible" || busy || timer !== undefined) return;
      if (shouldAsk(lastAsked, Date.now())) void ask();
    };
    visible();
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  return answer;
}
