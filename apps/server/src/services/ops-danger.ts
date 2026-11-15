/**
 * What the dangerous actions of Asetukset > Ylläpito share: the one way a request says no, and the one answer to "is
 * a reset under way".
 *
 * The reset (services/reset.ts) empties the database. Two may not run at once: the second would copy the emptied
 * database. It asks here before it starts and takes the mark with no wait in between. Nothing is stored: the mark
 * lives in this process.
 */
import type { Services } from "./context.ts";
import type { Req } from "./ops.ts";
import type { Refusal } from "./ops-validate.ts";
import { recordEvent } from "./security.ts";

/** Throws for a refusal and does nothing for null. */
export interface Refuse {
  (no: Refusal): Promise<never>;
  (no: Refusal | null): Promise<void>;
}

/**
 * Records the `ops_denied` event of a refusal, "<label>: <why>", and throws what the admin is told. The queue and the
 * reset refuse through this, so no refused attempt is missing from the audit list.
 */
export function refuser(s: Services, userId: string, req: Req, label: string): Refuse {
  return (async (no: Refusal | null) => {
    if (!no) return;
    await recordEvent(s, { kind: "ops_denied", userId, ...req, detail: `${label}: ${no.why}` });
    throw no.error;
  }) as Refuse;
}

/** The databases a reset is under way on. */
const underWay = new WeakSet<object>();

/** Whether a reset is under way on this app's database. */
export function resetUnderWay(s: Services): boolean {
  return underWay.has(s.db);
}

/** Takes the mark. The caller asked resetUnderWay and awaited nothing since, so two requests never both hold it. */
export function beginReset(s: Services): void {
  underWay.add(s.db);
}

export function endReset(s: Services): void {
  underWay.delete(s.db);
}
