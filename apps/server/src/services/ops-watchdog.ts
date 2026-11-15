/**
 * The watchdog report of the host helper. When the helper takes an update back by itself (the app did not answer after
 * it, or the new helper failed its self-test), its state carries `watchdog: { at, from, to, reason }` from then on.
 * The report becomes one `ops_watchdog` event and a `watchdog_notice` to every admin, once for each `at`.
 *
 * The state is data from outside. Only the four fields are read, each in one fixed form, and the texts are built from
 * them alone: a report out of form is dropped whole, the way an unknown state field is.
 */
import type { Services } from "./context.ts";
import { XYZ } from "./ops-validate.ts";
import { ROLLBACK_NAME, recordEvent } from "./security.ts";

/** The `at` of the last report whose rows were all written. */
const RECORDED_KEY = "ops_watchdog_at";
/**
 * The notice, one row for each admin. `noticesFor` in services/security.ts words it by this kind. It is no ops_ kind,
 * so the audit list of the maintenance page shows the event alone.
 */
const NOTICE_KIND = "watchdog_notice";

export interface WatchdogReport {
  /** When the helper took the update back, as an ISO time in UTC with milliseconds. */
  at: string;
  /** The version that was taken back. */
  from: string;
  /** The version that runs again. */
  to: string;
  reason: "unhealthy" | "self_test";
}

const WHY: Record<WatchdogReport["reason"], string> = {
  unhealthy: "sovellus ei vastannut 10 minuuttiin",
  self_test: "uusi ylläpitoapuri ei toiminut",
};

/** The form the helper's other times have (`checked_at` in ops-validate.ts). */
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;
const version = (v: unknown): v is string => typeof v === "string" && v.length <= 20 && XYZ.test(v);

/**
 * The report in a state, or null when there is none or it is out of form. Keys beside the four are not read, so a
 * later helper may say more.
 */
export function parseWatchdog(state: unknown): WatchdogReport | null {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return null;
  const w = (state as Record<string, unknown>).watchdog;
  if (typeof w !== "object" || w === null || Array.isArray(w)) return null;
  const { at, from, to, reason } = w as Record<string, unknown>;
  if (typeof at !== "string" || at.length > 40 || !ISO.test(at) || Number.isNaN(Date.parse(at))) return null;
  if (!version(from) || !version(to)) return null;
  if (reason !== "unhealthy" && reason !== "self_test") return null;
  // one spelling for one moment, so the same report is known again however the helper wrote the time
  return { at: new Date(at).toISOString(), from, to, reason };
}

/** What happened: the whole text of the notice and the outcome in the audit list ("päivitys: "). The one name first, then the reason and the two versions. No full stop: the notice ends with its time in brackets. */
const told = (w: WatchdogReport): string => `${ROLLBACK_NAME}, koska ${WHY[w.reason]}. Versiosta ${w.from} palattiin versioon ${w.to}`;

/** How many rows of a kind are newer than row `last`. */
const rowsAfter = async (s: Services, kind: string, last: number, most: number): Promise<number> => (await s.security.list({ kind, limit: most })).filter((e) => e.id > last).length;

/**
 * Takes the report of a helper's state in. A new `at` is recorded once, as the event and as a notice to every admin;
 * the same `at` again, a state without a report and a report out of form record nothing.
 */
export async function takeWatchdog(s: Services, state: unknown): Promise<void> {
  const w = parseWatchdog(state);
  if (!w || (await s.settings.get(RECORDED_KEY)) === w.at) return;
  const admins = (await s.users.list()).filter((u) => u.role === "admin");
  const last = (await s.security.list({ limit: 1 }))[0]?.id ?? 0;
  await recordEvent(s, { kind: "ops_watchdog", detail: `päivitys: ${told(w)}` });
  for (const u of admins) await recordEvent(s, { kind: NOTICE_KIND, userId: u.id, detail: told(w), notify: true });
  // Marked last, and only when every row is there: `recordEvent` keeps a failed insert to itself, and a report that is
  // marked is never told again. The helper repeats the report with every state, so a round that failed, also in part,
  // is told whole by the next one: a second notice is the lesser harm.
  const whole = (await rowsAfter(s, "ops_watchdog", last, 1)) === 1 && (await rowsAfter(s, NOTICE_KIND, last, admins.length)) === admins.length;
  if (whole) await s.settings.set(RECORDED_KEY, w.at);
}
