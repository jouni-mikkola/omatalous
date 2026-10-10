/**
 * Background work that a stop signal should wait for: a bank fetch, a scheduler tick, the upgrade tasks. HTTP
 * requests are not tracked here, closing the server waits for those.
 */
const running = new Set<Promise<unknown>>();

export function track<T>(work: Promise<T>): Promise<T> {
  running.add(work);
  const done = () => void running.delete(work);
  work.then(done, done);
  return work;
}

export function inflightCount(): number {
  return running.size;
}

/** Resolves true when nothing is running any more, false when `ms` passed first. */
export async function waitForInflight(ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (running.size > 0) {
    if (Date.now() >= deadline) return false;
    await Promise.race([Promise.allSettled([...running]), new Promise((r) => setTimeout(r, Math.max(1, Math.min(250, deadline - Date.now()))))]);
  }
  return true;
}
