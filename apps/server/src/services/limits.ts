/**
 * The limits of platform/limits.ts in their layers: the schema default, the environment (given at construction) and
 * the admin's values in the database, one JSON row of only the values that differ from the layers below. A save is
 * checked against the schema as a whole before anything is written; a field outside it is a 400. The values are
 * held in memory and a listener hears every change, so a changed limit takes effect on the next request with no restart.
 * A security event for a change is written by the route (routes/admin.ts), which knows the admin and the address.
 *
 * Decision: the admin decides which limit to raise or lower, and sees where each value comes from.
 */
import type { SettingsRepo } from "../db/settings-repo.ts";
import { hashMemoryProblem, LIMIT_SCHEMA, type LimitField, type LimitValues, parseLimit, type StoredLimitKey } from "../platform/limits.ts";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";

const KEY = "limits";

interface LimitChange {
  key: string;
  from: number;
  to: number;
}

interface LimitView extends Omit<LimitField, "home"> {
  value: number;
  source: "default" | "environment" | "database";
}

export class LimitStore {
  private readonly schema: readonly LimitField[];
  private stored: Record<string, number> = {};
  private merged: Record<string, number>;
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners: ((values: LimitValues) => void)[] = [];

  constructor(
    private readonly settings: SettingsRepo,
    private readonly env: Record<string, number>,
    schema: readonly LimitField[] = LIMIT_SCHEMA,
  ) {
    this.schema = schema.filter((f) => f.home === undefined);
    this.merged = this.compose();
  }

  /** Every stored limit as it is now. */
  get values(): LimitValues {
    return this.merged as LimitValues;
  }

  get<K extends StoredLimitKey>(key: K): number {
    return this.merged[key]!;
  }

  /** Calls `fn` now and after every change of a value. */
  onChange(fn: (values: LimitValues) => void): void {
    this.listeners.push(fn);
    fn(this.values);
  }

  /** The row is read on the first call, and again with `force`. */
  async load(force = false): Promise<void> {
    if (!force && this.loaded) return;
    const raw = await this.settings.get(KEY);
    let row: unknown = {};
    try {
      row = raw ? JSON.parse(raw) : {};
    } catch {
      console.error("limits row is not valid JSON, using the environment and defaults");
    }
    const stored: Record<string, number> = {};
    for (const f of this.schema) {
      const v = row !== null && typeof row === "object" ? (row as Record<string, unknown>)[f.key] : undefined;
      if (v === undefined) continue;
      try {
        stored[f.key] = parseLimit(f, v);
      } catch {
        // a row edited by hand must not stop the start or let an unsafe value in
        console.error(`limit ${f.key} in the database is outside the schema, ignored`);
      }
    }
    // slots times memory must fit the server also when the row was edited by hand or the environment changed under it
    if (hashMemoryProblem(this.composeWith(stored))) {
      console.error("hashSlots and passwordMemoryKib in the database hold more memory than allowed, ignored");
      delete stored.hashSlots;
      delete stored.passwordMemoryKib;
    }
    this.apply(stored);
    this.loaded = true;
  }

  /**
   * A partial update: a number sets the value, null gives it back to the environment or the default. Returns what
   * changed and which of those need a restart. Nothing is stored when any field is refused.
   */
  save(input: unknown): Promise<{ changed: LimitChange[]; restart: string[] }> {
    // one save at a time: each reads the row and writes it whole, so two at once would lose one
    const run = this.queue.then(() => this.write(input));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async write(input: unknown): Promise<{ changed: LimitChange[]; restart: string[] }> {
    const o = strictObject(input, this.schema.map((f) => f.key));
    await this.load(true);
    const next = { ...this.stored };
    for (const f of this.schema) {
      const v = o[f.key];
      if (v === undefined) continue;
      if (v === null) delete next[f.key];
      else next[f.key] = parseLimit(f, v);
    }
    const problem = hashMemoryProblem(this.composeWith(next));
    if (problem) throw new UserError(problem);
    const before = this.merged;
    await this.settings.set(KEY, JSON.stringify(next));
    this.apply(next);
    const changed = this.schema.filter((f) => before[f.key] !== this.merged[f.key]).map((f) => ({ key: f.key, from: before[f.key]!, to: this.merged[f.key]! }));
    const restart = changed.filter((c) => this.schema.find((f) => f.key === c.key)!.restart).map((c) => c.key);
    return { changed, restart };
  }

  /** The fields with their values and where each comes from, for the settings page. */
  view(): LimitView[] {
    return this.schema.map(({ home: _home, ...f }) => ({
      ...f,
      value: this.merged[f.key]!,
      source: f.key in this.stored ? "database" : this.env[f.key] !== f.default ? "environment" : "default",
    }));
  }

  private compose(): Record<string, number> {
    return this.composeWith(this.stored);
  }

  private composeWith(stored: Record<string, number>): Record<string, number> {
    return Object.fromEntries(this.schema.map((f) => [f.key, stored[f.key] ?? this.env[f.key] ?? f.default]));
  }

  private apply(stored: Record<string, number>): void {
    this.stored = stored;
    const next = this.compose();
    const moved = this.schema.some((f) => next[f.key] !== this.merged[f.key]);
    this.merged = next;
    if (moved) for (const fn of this.listeners) fn(this.values);
  }
}
