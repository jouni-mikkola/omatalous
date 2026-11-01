import { dateTime } from "../../format.ts";
import { S } from "./ops-strings.ts";
import type { DoctorItem, OpsRequestView, OpsSnapshot } from "./types.ts";

/** The words for how an action last ended: when and the outcome, and for a failure the helper's own summary (the progress block above shows the summary of the newest request). Nothing yet: say so. */
export function lastResult(r: OpsRequestView | undefined): { text: string; tone: "good" | "warning" | "muted" } {
  if (!r) return { text: S.neverRun, tone: "muted" };
  const when = dateTime(r.finishedAt ?? r.requestedAt);
  if (r.status === "queued" || r.status === "running") return { text: S.lastRunning(dateTime(r.requestedAt)), tone: "muted" };
  const outcome = { ok: S.ok, failed: S.failed, expired: S.expired, cancelled: S.cancelled }[r.status];
  const text = `${S.lastAt(when)}: ${outcome}${r.status === "failed" && r.summary ? `. ${r.summary}` : ""}`;
  return { text, tone: r.status === "ok" ? "good" : r.status === "failed" ? "warning" : "muted" };
}

/** The disk lines of the system check (the folder, and Docker's data when it is on another disk): the worst one. The check words them (scripts/doctor.sh) and each title starts "Levy (" or "Disk (" in English. */
export function diskItem(doctor: OpsSnapshot["doctor"]): DoctorItem | undefined {
  const rank = { ok: 0, warn: 1, error: 2 };
  return doctor?.items.filter((i) => /^(Levy|Disk) \(/.test(i.title)).reduce<DoctorItem | undefined>((worst, i) => (worst && rank[worst.level] >= rank[i.level] ? worst : i), undefined);
}

/** The newest copy of the two lists, by time. */
export function newestBackup(lists: { at: string }[][]): string | null {
  const all = lists.flat().map((b) => b.at);
  return all.length ? all.reduce((a, b) => (a > b ? a : b)) : null;
}
