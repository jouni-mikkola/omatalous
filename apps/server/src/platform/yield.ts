/**
 * Lets the event loop serve other requests (and the container health check) between two pieces of a long job.
 * node:sqlite is synchronous, so a job that never yields blocks every request for its whole run.
 */
export function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
