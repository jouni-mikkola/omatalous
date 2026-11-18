/**
 * What one request reads of the household and holds for the rest of that request: the accounts the viewer may see with
 * their uses, the household as a trace reads it, the trace facts of each pool. A request that asks for the view more
 * than once (the dashboard and its proposals, /meta and its accounts, the queue and its split questions) reads each of
 * these once. The object is made by the request and handed down by hand, never kept: the next request reads afresh, so
 * a write between two requests is always seen. The locks are handed down by hand for the same reason (`enrich.ts`).
 */
export class RequestReads {
  private epoch = 0;
  private readonly held = new Map<string, Promise<unknown>>();

  /** The answer of `read` for `name` and `key`, read on the first ask. A failed read is not kept. */
  once<T>(name: string, key: string, read: () => Promise<T>): Promise<T> {
    const at = `${name}\0${key}`;
    const kept = this.held.get(at);
    if (kept) return kept as Promise<T>;
    const started = this.epoch;
    const reading = read();
    this.held.set(at, reading);
    // a read that failed, or that a change overtook while it ran, is read again by the next ask
    const drop = () => this.held.get(at) === reading && this.held.delete(at);
    reading.then(() => started !== this.epoch && drop(), drop);
    return reading;
  }

  /** The request wrote something the reads above depend on (a trace was built again, a run ended): later asks read again. */
  changed(): void {
    this.epoch++;
    this.held.clear();
  }
}
