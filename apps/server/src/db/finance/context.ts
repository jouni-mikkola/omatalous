/**
 * What the modules of the finance repo share: the database and the one user they serve. A module reads the user
 * from here and nowhere else, and each of its statements names `ctx.userId`. It writes only this user's rows. It
 * reads another member's rows only for accounts HouseholdRepo has resolved as shared with this user.
 */
import type { Db, Statement } from "../types.ts";

export interface FinanceContext {
  readonly db: Db;
  readonly userId: string;
}

/** Statements per write transaction of derived data and of a big import. */
export const WRITE_CHUNK = 2000;

/** Runs the statements in one transaction; an empty list is no transaction. */
export async function writeBatch(db: Db, statements: Statement[]): Promise<void> {
  if (statements.length) await db.batch(statements);
}
