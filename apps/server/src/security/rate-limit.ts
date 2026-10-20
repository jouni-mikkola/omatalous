type Entry = { count: number; resetAt: number; announced: boolean };

/**
 * What consume() answers: `wait` is the seconds to wait (0 = allowed and counted), `first` is true for the first
 * refusal of a window. `full` marks a refusal that is about the limiter and not the key: the key has no entry and
 * could not get one, because every key held is over its limit.
 */
export type Attempt = { wait: number; first: boolean; full: boolean };

/**
 * In-memory fixed-window limiter for login attempts. Per process, which is
 * enough to make online password guessing impractical for a household app;
 * the strong password hash does the rest.
 *
 * An attempt is counted with consume() before the slow password hash runs,
 * so parallel requests cannot all pass the check before the first failure
 * is recorded. A successful attempt is given back with release() or reset().
 *
 * Each limiter holds at most `maxKeys` keys, so rotating keys cannot grow it
 * without bound. A new key makes room by dropping ended windows, then the
 * oldest key that is under its limit. A key over its limit is never dropped
 * early, and when every key held is over its limit a new key is refused, not
 * waved through. The login limits have a spare for that case (LoginLimiter).
 */
export class RateLimiter {
  // in the order the windows started (a new window is set at the back), so ended windows are at the front
  private readonly hits = new Map<string, Entry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Returns seconds to wait, or 0 when the attempt is allowed. Does not count. */
  check(key: string, now = Date.now()): number {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) return 0;
    return entry.count >= this.limit ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }

  /** True while the key has a window running here, whatever its count. */
  holds(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    return entry !== undefined && entry.resetAt > now;
  }

  /**
   * Counts an attempt unless the key is over its limit. `wait` is the seconds
   * to wait (0 = allowed and counted); `first` is true for the first refusal
   * of a window, so a lockout is reported once.
   */
  consume(key: string, now = Date.now()): Attempt {
    const entry = this.hits.get(key);
    if (entry && entry.resetAt > now) {
      if (entry.count >= this.limit) {
        const first = !entry.announced;
        entry.announced = true;
        return { wait: Math.ceil((entry.resetAt - now) / 1000), first, full: false };
      }
      entry.count += 1;
      return { wait: 0, first: false, full: false };
    }
    if (entry) this.hits.delete(key);
    else if (!this.makeRoom(now)) {
      // every key held is over its limit: dropping one would end its lockout early. Not announced, a full
      // map would otherwise write an event per request.
      return { wait: this.oldestWait(now), first: false, full: true };
    }
    this.hits.set(key, { count: 1, resetAt: now + this.windowMs, announced: false });
    return { wait: 0, first: false, full: false };
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

  /** How many keys are held now. */
  get size(): number {
    return this.hits.size;
  }

  /** Room for one more key: ended windows go first, then the oldest key under its limit. False when none can go. */
  private makeRoom(now: number): boolean {
    if (this.hits.size < this.maxKeys) return true;
    for (const [k, v] of this.hits) {
      if (v.resetAt > now) break;
      this.hits.delete(k);
    }
    if (this.hits.size < this.maxKeys) return true;
    // the scan also catches an ended window that a clock change left behind a live one
    for (const [k, v] of this.hits) {
      if (v.count < this.limit || v.resetAt <= now) {
        this.hits.delete(k);
        return true;
      }
    }
    return false;
  }

  private oldestWait(now: number): number {
    let soonest = Number.POSITIVE_INFINITY;
    for (const v of this.hits.values()) soonest = Math.min(soonest, v.resetAt);
    return Math.max(1, Math.ceil((soonest - now) / 1000));
  }
}

/**
 * One login limit with a spare for remembered addresses (RememberedAddresses). The main limiter refuses every new
 * key while all the keys it holds are over their limit, so a flood of made-up names from many addresses could keep
 * the household from signing in. An attempt from a remembered address is then counted in the spare. The spare has
 * the same limit and window and takes new keys only from such attempts, so the flood cannot fill it.
 *
 * The spare gives no key a second count and ends no lockout. A key has one entry, in the main limiter or in the
 * spare: a key the main limiter holds is counted and refused there, for a remembered address too, and a key the
 * spare holds is counted there for every caller until its window ends. While the main limiter has room the spare
 * is not used at all.
 */
export class LoginLimiter {
  private readonly main: RateLimiter;
  private readonly spare: RateLimiter;

  constructor(limit: number, windowMs: number, maxKeys = 10_000, spareKeys = 1_000) {
    this.main = new RateLimiter(limit, windowMs, maxKeys);
    this.spare = new RateLimiter(limit, windowMs, spareKeys);
  }

  /** As RateLimiter.consume. `remembered` tells that the attempt comes from a remembered address. */
  consume(key: string, remembered: boolean, now = Date.now()): Attempt {
    if (this.spare.holds(key, now)) return this.spare.consume(key, now);
    // an ended window may still lie in the spare: dropped, so a clock set back cannot wake a second count for the key
    this.spare.reset(key);
    const attempt = this.main.consume(key, now);
    // `full` is the one refusal the spare answers: the key has no entry in the main limiter and could not get one
    if (!attempt.full || !remembered) return attempt;
    return this.spare.consume(key, now);
  }

  /** Seconds to wait, or 0. Does not count. */
  check(key: string, now = Date.now()): number {
    return this.holder(key, now).check(key, now);
  }

  /** Gives one counted attempt back, where it was counted. */
  release(key: string, now = Date.now()): void {
    this.holder(key, now).release(key, now);
  }

  reset(key: string): void {
    this.main.reset(key);
    this.spare.reset(key);
  }

  /** Keys held by the main limiter. */
  get size(): number {
    return this.main.size;
  }

  /** Keys held by the spare. */
  get spareSize(): number {
    return this.spare.size;
  }

  private holder(key: string, now: number): RateLimiter {
    return this.spare.holds(key, now) ? this.spare : this.main;
  }
}

/**
 * The addresses (as addressKey, so IPv6 by /64) a login succeeded from in the last `ttlMs`: at most `max`, the one
 * that signed in longest ago goes first. Kept in memory only, so a restart empties it. The login route adds an
 * address after a correct password and nowhere else, so nobody can put an address here without one.
 */
export class RememberedAddresses {
  // in the order of the last successful login, oldest first
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly max = 100,
    private readonly ttlMs = 30 * 24 * 3600_000,
  ) {}

  has(key: string, now = Date.now()): boolean {
    const at = this.seen.get(key);
    return at !== undefined && now - at < this.ttlMs;
  }

  add(key: string, now = Date.now()): void {
    this.seen.delete(key);
    this.seen.set(key, now);
    for (const [k, at] of this.seen) {
      if (this.seen.size <= this.max && now - at < this.ttlMs) break;
      this.seen.delete(k);
    }
  }

  get size(): number {
    return this.seen.size;
  }
}

/**
 * The key a client address is limited under. An IPv6 client gets a whole /64 and can use any address in it, so
 * IPv6 counts as its /64. An IPv4-mapped IPv6 address (::ffff:192.0.2.1, what a dual-stack socket reports for
 * IPv4) counts as the IPv4 address. Anything else is kept as it is, cut to the length of the longest address.
 */
export function addressKey(address: string): string {
  let a = address.trim().toLowerCase();
  if (a.startsWith("[")) a = a.slice(1, a.includes("]") ? a.indexOf("]") : undefined);
  if (a.includes("%")) a = a.slice(0, a.indexOf("%")); // zone id: fe80::1%eth0
  const g = a.includes(":") ? ipv6Groups(a) : null;
  if (!g) return a.slice(0, 45);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255].join(".");
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/** The eight 16-bit groups of an IPv6 address in any text form (`::`, a dotted IPv4 tail), or null when it is not one. */
function ipv6Groups(text: string): number[] | null {
  let s = text;
  const tail: number[] = [];
  const v4 = /(?:^|:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const b = v4.slice(1).map(Number);
    if (b.some((n) => n > 255)) return null;
    tail.push((b[0]! << 8) | b[1]!, (b[2]! << 8) | b[3]!);
    // keep a "::" that ends right before the IPv4 part, drop a single ":"
    s = s.slice(0, s.length - v4[0].length + 1);
    s = s.endsWith("::") ? s : s.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parts = (h: string) => (h === "" ? [] : h.split(":"));
  const head = parts(halves[0]!);
  const rest = halves.length === 2 ? parts(halves[1]!) : [];
  if (![...head, ...rest].every((p) => /^[0-9a-f]{1,4}$/.test(p))) return null;
  const known = head.length + rest.length + tail.length;
  const hex = (l: string[]) => l.map((p) => Number.parseInt(p, 16));
  if (halves.length === 1) return known === 8 ? [...hex(head), ...tail] : null;
  if (known > 7) return null;
  return [...hex(head), ...new Array<number>(8 - known).fill(0), ...hex(rest), ...tail];
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
