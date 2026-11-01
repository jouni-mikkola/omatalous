import { useEffect, useRef } from "react";
import type { Account, Connection } from "./types.ts";

/**
 * True while an active consent has no answer yet: an account not fetched (and with no stopping problem), or no account
 * at all, which is how a consent looks before its first fetch has listed them. The pages look again while this holds.
 */
export function waitsForFirstFetch(connections: readonly Pick<Connection, "id" | "state">[], accounts: readonly Pick<Account, "connectionId" | "lastSyncedAt" | "problem">[]): boolean {
  return connections
    .filter((c) => c.state === "active")
    .some((c) => {
      const own = accounts.filter((a) => a.connectionId === c.id);
      return own.length === 0 || own.some((a) => !a.lastSyncedAt && !a.problem);
    });
}

/** While `waiting`, calls `reload` every 5 seconds for a minute, then every 30 seconds; the caller owns what it reloads. */
export function useLookAgain(waiting: boolean, reload: () => void): void {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    if (!waiting) return;
    let looked = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        looked++;
        latest.current();
        next();
      }, looked < 12 ? 5000 : 30_000);
    };
    next();
    return () => clearTimeout(timer);
  }, [waiting]);
}
