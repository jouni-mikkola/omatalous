/**
 * What /api/health reports. A cheap read on every call and `PRAGMA quick_check` once an hour (0.3 s for 330 000
 * rows), so a damaged page, a full disk or a locked database shows up as an unhealthy container and not only
 * as "Jokin meni vikaan" on a page. The endpoint is public, so the reason is a fixed word and the details go to
 * the log.
 */
import type { Services } from "./context.ts";

export type Health = { ok: true } | { ok: false; reason: "database unreadable" | "database damaged" };

const GOOD_FOR_MS = 3600_000;
/** A failed check is repeated at most this often: quick_check on a big file is not free. */
const BAD_FOR_MS = 60_000;

interface Cached {
  at: number;
  result: Health;
}
const cache = new WeakMap<Services, Cached>();

export async function checkHealth(s: Services): Promise<Health> {
  const now = s.now().getTime();
  const hit = cache.get(s);
  if (hit && !hit.result.ok && now - hit.at < BAD_FOR_MS) return hit.result;
  const wasOk = !hit || hit.result.ok;
  let result: Health;
  try {
    await s.db.first("SELECT value FROM settings LIMIT 1");
    if (hit?.result.ok && now - hit.at < GOOD_FOR_MS) return hit.result;
    const check = await s.db.all<{ quick_check: string }>("PRAGMA quick_check(5)");
    if (check.length === 1 && check[0]!.quick_check === "ok") result = { ok: true };
    else {
      result = { ok: false, reason: "database damaged" };
      if (wasOk) console.error(`health: the database failed quick_check: ${check.map((r) => r.quick_check).join("; ").slice(0, 300)}. Restore a copy: docs/ADVANCED.md#restore-a-backup`);
    }
  } catch (err) {
    result = { ok: false, reason: "database unreadable" };
    if (wasOk) console.error(`health: the database cannot be read: ${(err as Error).message}`);
  }
  cache.set(s, { at: now, result });
  return result;
}
