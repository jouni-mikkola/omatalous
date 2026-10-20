/**
 * A small in-memory map whose entries end after a time. For what must not outlive a restart anyway: a started
 * enrolment waiting for its first code, and a sign-in that has the password right and waits for the second factor.
 * Bounded, so a flood of password-right logins cannot grow it without end: the oldest entry makes room.
 */
export class ShortLived<T> {
  private readonly items = new Map<string, { value: T; until: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxKeys = 1_000,
  ) {}

  set(key: string, value: T, now: number): void {
    this.items.delete(key);
    for (const [k, v] of this.items) if (v.until <= now) this.items.delete(k);
    while (this.items.size >= this.maxKeys) this.items.delete(this.items.keys().next().value as string);
    this.items.set(key, { value, until: now + this.ttlMs });
  }

  get(key: string, now: number): T | undefined {
    const item = this.items.get(key);
    if (!item) return undefined;
    if (item.until <= now) {
      this.items.delete(key);
      return undefined;
    }
    return item.value;
  }

  delete(key: string): void {
    this.items.delete(key);
  }
}
