/**
 * Optimoi: the numbers the user typed in, their decisions on findings, and the monthly snapshot of the follow-up. Own
 * rows only. Nothing here touches transactions, categories or rules, so none of it moves a data version.
 */
import { DISMISS_REASONS, type DismissReason, type FindingState, inputDefOf, type InputValue, type IsoDate, parseFindingId, type StoredInput } from "@banking/core";
import type { Row } from "../rows.ts";
import type { Statement } from "../types.ts";
import { type FinanceContext, writeBatch } from "./context.ts";

/** An input as stored: its full key (`car_km`, `insurance_quote:<series id>`) and what the core keeps of it. */
export interface InputRow extends StoredInput {
  key: string;
}

export interface SnapshotRow {
  month: string;
  data: unknown;
  createdAt: string;
}

/** JSON text a row holds, or undefined when it does not parse: a damaged value is left out, never thrown at the page. */
function parse(text: unknown): unknown {
  try {
    return JSON.parse(String(text));
  } catch {
    return undefined;
  }
}

/**
 * The key or finding id with a renamed merchant. The subject is the merchant itself or a series id,
 * `<direction>:<account>:<merchant>` with `#<product>` or `#habit` after it. Null when the subject names no renamed merchant.
 */
export function renamedSubject(subject: string, renames: ReadonlyMap<string, string>): string | null {
  const direct = renames.get(subject);
  if (direct !== undefined) return direct;
  const series = /^(in|out):([^:]*):(.+)$/su.exec(subject);
  if (!series) return null;
  const [, direction, account, rest] = series;
  const whole = renames.get(rest!);
  if (whole !== undefined) return `${direction}:${account}:${whole}`;
  // only the suffixes recurring.ts writes are cut, so renaming "Foo" leaves a merchant called "Foo#2" alone
  const suffix = /#(?:habit|-?\d+)$/u.exec(rest!);
  const to = suffix ? renames.get(rest!.slice(0, suffix.index)) : undefined;
  return to === undefined ? null : `${direction}:${account}:${to}${suffix![0]}`;
}

export class OptimiseRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /** The user's typed inputs by key. A row whose value is not JSON is left out. */
  async listInputs(): Promise<InputRow[]> {
    const rows = await this.ctx.db.all<Row>("SELECT key, value, as_of FROM optimise_inputs WHERE user_id = ? ORDER BY key", [this.ctx.userId]);
    return rows.flatMap((r) => {
      const value = parse(r.value);
      return value === undefined ? [] : [{ key: String(r.key), value: value as InputValue, asOf: String(r.as_of) as IsoDate }];
    });
  }

  /** One input per key: a later value replaces the earlier one and takes its day. The caller has validated the value. */
  async setInput(key: string, value: InputValue, asOf: IsoDate): Promise<void> {
    await this.ctx.db.run(
      "INSERT INTO optimise_inputs (user_id, key, value, as_of) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, as_of = excluded.as_of",
      [this.ctx.userId, key, JSON.stringify(value), asOf],
    );
  }

  /** False when the user had no such input. */
  async deleteInput(key: string): Promise<boolean> {
    return (await this.ctx.db.run("DELETE FROM optimise_inputs WHERE user_id = ? AND key = ?", [this.ctx.userId, key])).changes > 0;
  }

  /** The user's decisions, the latest first. */
  async listStates(): Promise<FindingState[]> {
    const rows = await this.ctx.db.all<Row>(
      "SELECT finding_id, status, reason, until, effective_date, mid_cents, baseline, decided_at FROM optimise_states WHERE user_id = ? ORDER BY decided_at DESC, finding_id",
      [this.ctx.userId],
    );
    return rows.map((r) => {
      const baseline = r.baseline === null ? undefined : parse(r.baseline);
      return {
        findingId: String(r.finding_id),
        status: String(r.status) as FindingState["status"],
        reason: (DISMISS_REASONS as readonly string[]).includes(String(r.reason)) ? (String(r.reason) as DismissReason) : null,
        until: r.until === null ? null : (String(r.until) as IsoDate),
        effectiveDate: r.effective_date === null ? null : (String(r.effective_date) as IsoDate),
        midCents: r.mid_cents === null ? null : Number(r.mid_cents),
        baseline: Array.isArray(baseline) ? (baseline as FindingState["baseline"]) : null,
        decidedAt: String(r.decided_at),
      };
    });
  }

  /** One decision per finding: a later choice replaces the earlier one. */
  async setState(state: FindingState): Promise<void> {
    await this.ctx.db.run(
      `INSERT INTO optimise_states (user_id, finding_id, status, reason, until, effective_date, mid_cents, baseline, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, finding_id) DO UPDATE SET status = excluded.status, reason = excluded.reason, until = excluded.until,
         effective_date = excluded.effective_date, mid_cents = excluded.mid_cents, baseline = excluded.baseline, decided_at = excluded.decided_at`,
      [
        this.ctx.userId,
        state.findingId,
        state.status,
        state.reason,
        state.until,
        state.effectiveDate,
        state.midCents,
        state.baseline === null ? null : JSON.stringify(state.baseline),
        state.decidedAt,
      ],
    );
  }

  async clearState(findingId: string): Promise<void> {
    await this.ctx.db.run("DELETE FROM optimise_states WHERE user_id = ? AND finding_id = ?", [this.ctx.userId, findingId]);
  }

  /**
   * The user's latest snapshot of a month (`YYYY-MM`) or before it, or null. The follow-up reads this month's and the
   * last one before it, and walks back one row at a time for its line, which holds a year.
   */
  async getSnapshot(month: string): Promise<SnapshotRow | null> {
    const row = await this.ctx.db.first<Row>("SELECT month, data, created_at FROM optimise_snapshots WHERE user_id = ? AND month <= ? ORDER BY month DESC LIMIT 1", [
      this.ctx.userId,
      month,
    ]);
    if (!row) return null;
    const data = parse(row.data);
    return data === undefined ? null : { month: String(row.month), data, createdAt: String(row.created_at) };
  }

  /** One snapshot per month: writing it again replaces it. `data` is the follow-up's entries, built by core `snapshotOf`. */
  async putSnapshot(month: string, data: unknown, createdAt: string): Promise<void> {
    await this.ctx.db.run(
      "INSERT INTO optimise_snapshots (user_id, month, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, month) DO UPDATE SET data = excluded.data, created_at = excluded.created_at",
      [this.ctx.userId, month, JSON.stringify(data), createdAt],
    );
  }

  /**
   * A merchant's name was derived again: the decisions on its findings and the insurance quotes of its series follow,
   * as marks do. When the new name has a row already, that one stays and the old one is dropped.
   */
  async renameMerchantStates(renames: ReadonlyMap<string, string>): Promise<void> {
    if (!renames.size) return;
    const [states, inputs] = await Promise.all([
      this.ctx.db.all<Row>("SELECT finding_id FROM optimise_states WHERE user_id = ?", [this.ctx.userId]),
      this.ctx.db.all<Row>("SELECT key FROM optimise_inputs WHERE user_id = ?", [this.ctx.userId]),
    ]);
    const statements: Statement[] = [];
    for (const { finding_id } of states) {
      const old = String(finding_id);
      const parts = parseFindingId(old);
      const to = parts?.subject ? renamedSubject(parts.subject, renames) : null;
      const next = parts && to !== null ? `${parts.area}:${parts.kind}:${to}` : null;
      if (next === null || next === old || !parseFindingId(next)) continue;
      statements.push(
        { sql: "UPDATE OR IGNORE optimise_states SET finding_id = ? WHERE user_id = ? AND finding_id = ?", params: [next, this.ctx.userId, old] },
        { sql: "DELETE FROM optimise_states WHERE user_id = ? AND finding_id = ?", params: [this.ctx.userId, old] },
      );
    }
    for (const { key } of inputs) {
      const old = String(key);
      const found = inputDefOf(old);
      const to = found?.subject ? renamedSubject(found.subject, renames) : null;
      const next = found && to !== null ? `${found.def.key}:${to}` : null;
      if (next === null || next === old || !inputDefOf(next)) continue;
      statements.push(
        { sql: "UPDATE OR IGNORE optimise_inputs SET key = ? WHERE user_id = ? AND key = ?", params: [next, this.ctx.userId, old] },
        { sql: "DELETE FROM optimise_inputs WHERE user_id = ? AND key = ?", params: [this.ctx.userId, old] },
      );
    }
    await writeBatch(this.ctx.db, statements);
  }
}
