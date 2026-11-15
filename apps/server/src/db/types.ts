export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

/**
 * The only database surface the app uses, implemented with node:sqlite
 * (db/node-sqlite.ts).
 */
export interface Db {
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Runs reads in one read transaction, so the answers are one consistent snapshot. */
  readMany(statements: Statement[]): Promise<Record<string, SqlValue>[][]>;
  /** Runs statements in one transaction. */
  batch(statements: Statement[]): Promise<void>;
}
