/**
 * Stop on SIGTERM/SIGINT, and on a fault nothing caught (an uncaught exception, an unhandled rejection): no new
 * scheduled work, no new requests, running work gets a bounded time to finish, then the connections are cut and
 * the database is closed. The wait fits inside Docker's default stop timeout of 10 s. A longer one needs
 * stop_grace_period in docker-compose.yml, which the maintenance helper of 0.4.0 refuses, so add it only once
 * installs run a helper that allows the key (0.5.0 and later).
 */
import { oneLine } from "../services/ops-validate.ts";

export interface ShutdownDeps {
  stopScheduler(): void;
  closeServer(done: () => void): void;
  closeConnections(): void;
  waitForInflight(ms: number): Promise<boolean>;
  closeDb(): void;
  exit(code: number): void;
  /** How long running work may take. */
  timeoutMs: number;
  log(message: string): void;
}

/** Longer than a typical fetch page or import, shorter than Docker's default stop timeout of 10 s. */
export const SHUTDOWN_WAIT_MS = 8_000;

async function shutdown(d: ShutdownDeps, code = 0): Promise<void> {
  d.stopScheduler();
  const serverClosed = new Promise<boolean>((resolve) => d.closeServer(() => resolve(true)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), d.timeoutMs);
  });
  const finished = Promise.all([serverClosed, d.waitForInflight(d.timeoutMs)]).then(([a, b]) => a && b);
  const clean = await Promise.race([finished, timeout]);
  if (timer) clearTimeout(timer);
  if (!clean) d.log(`stopping: work still running after ${Math.round(d.timeoutMs / 1000)} s, cutting connections`);
  d.closeConnections();
  try {
    d.closeDb();
  } catch (err) {
    d.log(`stopping: closing the database failed: ${(err as Error).message}`);
  }
  d.exit(code);
}

export const STOP_SIGNALS = ["SIGINT", "SIGTERM"] as const;
export const STOP_FAULTS = ["uncaughtException", "unhandledRejection"] as const;
type StopEvent = (typeof STOP_SIGNALS)[number] | (typeof STOP_FAULTS)[number];

/** The most of an error the log line keeps: the message and the first frames of the stack. */
const FAULT_LINE_MAX = 2_000;

/** The error on one line, stack included, so the log keeps where it came from. */
const told = (err: unknown): string => oneLine(err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err), FAULT_LINE_MAX);

/**
 * The handler for the signals and the faults: the first event starts the one shutdown. A later signal is ignored,
 * a later fault is logged and starts nothing. A signal exits 0, a fault logs its error and exits 1.
 */
export function stopHandler(d: ShutdownDeps): (event: StopEvent, err?: unknown) => void {
  let stopping = false;
  return (event, err) => {
    const fault = (STOP_FAULTS as readonly string[]).includes(event);
    if (stopping) {
      // the error is kept in the log; the shutdown under way and its exit code stay as they are
      if (fault) d.log(`${event} while stopping: ${told(err)}`);
      return;
    }
    stopping = true;
    const wait = `running work gets ${d.timeoutMs / 1000} s`;
    d.log(fault ? `${event}: ${told(err)}; stopping, ${wait}` : `${event}: stopping, ${wait}`);
    // a shutdown that itself fails must still end the process: the guard above ignores its rejection
    shutdown(d, fault ? 1 : 0).catch((failed) => {
      d.log(`stopping failed: ${told(failed)}`);
      d.exit(1);
    });
  };
}
