import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import { confirmBody } from "./ops-strings.ts";
import type { RestoreCopy, RestoreState } from "./types.ts";

/** After the request the app stops itself and Docker starts it again. The first check waits for the stop. */
const FIRST_MS = 1500;
const EVERY_MS = 2500;
/** An answer from the old process before it stopped does not count; with no failed check seen, this long is enough. */
const AT_LEAST_MS = 20_000;

/** Reads /api/health until it answers again. Anything but a 200 (a proxy's 502, the app's own 503) counts as still down. */
function useAppBack(active: boolean) {
  const [back, setBack] = useState(false);
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    let seenDown = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let up = true;
      try {
        await api("/api/health");
      } catch {
        up = false;
      }
      if (stopped) return;
      const ms = Date.now() - started;
      setWaited(ms);
      if (!up) seenDown = true;
      if (up && (seenDown || ms >= AT_LEAST_MS)) {
        setBack(true);
        return;
      }
      timer = setTimeout(() => void tick(), EVERY_MS);
    };
    timer = setTimeout(() => void tick(), FIRST_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);
  return { back, waited };
}

/**
 * The restore of the newest intact copy, for the row of that copy in the list of copies. The copy is read when the list
 * opens and again when it changes (`listKey`), never on a timer: each read checks the whole copy. A restore is only
 * asked for here. Whether it was done is told by the notice after the start, so the page never says it was.
 */
export function useRestore(listKey: string) {
  const [state, setState] = useState<RestoreState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<RestoreCopy | null>(null);
  const [stillPending, setStillPending] = useState<boolean | null>(null);
  const { back, waited } = useAppBack(asked !== null);

  useEffect(() => {
    if (asked) return;
    let cancelled = false;
    api<RestoreState>("/api/ops/restore-latest")
      .then((r) => {
        if (cancelled) return;
        setState(r);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [listKey, asked]);

  // one read after the app is back: a request that still waits means the restore has not been done
  useEffect(() => {
    if (!back) return;
    api<RestoreState>("/api/ops/restore-latest")
      .then((r) => setStillPending(r.pending))
      // no answer (the session may not exist in the restored database): the notice is still what tells
      .catch(() => setStillPending(false));
  }, [back]);

  const send = async (password: string, confirm: string) => {
    const r = await api<{ copy: RestoreCopy }>("/api/ops/restore-latest", { method: "POST", body: confirmBody(password, confirm) });
    setAsked(r.copy);
  };

  return { state, error, asked, back, waited, stillPending, send };
}
