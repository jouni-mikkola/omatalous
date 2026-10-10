/**
 * In-memory fixed-window limiter for login attempts. Per process, which is
 * enough to make online password guessing impractical for a household app;
 * the strong password hash does the rest.
 *
 * An attempt is counted with consume() before the slow password hash runs,
 * so parallel requests cannot all pass the check before the first failure
 * is recorded. A successful attempt is given back with release() or reset().
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number; announced: boolean }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns seconds to wait, or 0 when the attempt is allowed. Does not count. */
  check(key: string, now = Date.now()): number {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) return 0;
    return entry.count >= this.limit ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }

  /**
   * Counts an attempt unless the key is over its limit. `wait` is the seconds
   * to wait (0 = allowed and counted); `first` is true for the first refusal
   * of a window, so a lockout is reported once.
   */
  consume(key: string, now = Date.now()): { wait: number; first: boolean } {
    const entry = this.hits.get(key);
    if (entry && entry.resetAt > now && entry.count >= this.limit) {
      const first = !entry.announced;
      entry.announced = true;
      return { wait: Math.ceil((entry.resetAt - now) / 1000), first };
    }
    this.fail(key, now);
    return { wait: 0, first: false };
  }

  fail(key: string, now = Date.now()): void {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs, announced: false });
    else entry.count += 1;
    if (this.hits.size > 10_000) this.sweep(now);
  }

  /** Gives one counted attempt back (a successful login must not use up the address limit). */
  release(key: string, now = Date.now()): void {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) return;
    entry.count -= 1;
    if (entry.count <= 0) this.hits.delete(key);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

/** Caps how many password hashes run at once; the rest are refused at once instead of queueing. */
export class Gate {
  private active = 0;

  constructor(private readonly max: number) {}

  tryEnter(): boolean {
    if (this.active >= this.max) return false;
    this.active++;
    return true;
  }

  leave(): void {
    this.active = Math.max(0, this.active - 1);
  }
}
