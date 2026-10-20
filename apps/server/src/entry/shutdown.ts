/**
 * Stop on SIGTERM/SIGINT: no new scheduled work, no new requests, running work gets a bounded time to finish,
 * then the connections are cut and the database is closed. The wait fits inside Docker's default stop timeout
 * of 10 s. A longer one needs stop_grace_period in docker-compose.yml, which the maintenance helper of 0.4.0
 * refuses, so add it only once installs run a helper that allows the key (0.5.0 and later).
 */
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

export async function shutdown(d: ShutdownDeps): Promise<void> {
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
  d.exit(0);
}
