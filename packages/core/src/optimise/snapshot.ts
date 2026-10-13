/**
 * The follow-up's monthly snapshot: per finding only its id, area, mid, certainty and status. It drives Muutokset viime
 * käynnin jälkeen (`changesSince`) and the found side of the follow-up line (`followUpOf` in outcome.ts). Pure.
 */
import { parseFindingId } from "./common.ts";
import { AREA_IDS, type AreaId, type CertaintyLevel, type Finding, type FindingState, type FindingStatus, type OptimiseData } from "./types.ts";

export type SnapshotStatus = "active" | FindingStatus;

/** One finding in the monthly snapshot, and nothing else. */
export interface SnapshotEntry {
  id: string;
  area: AreaId;
  midCents: number | null;
  certainty: CertaintyLevel | null;
  status: SnapshotStatus;
}

export interface Snapshot {
  /** YYYY-MM */
  month: string;
  entries: readonly SnapshotEntry[];
}

export type ChangeKind = "new" | "grown" | "shrunk" | "resolved";

/** Muutokset viime käynnin jälkeen: an active finding that appeared, grew or shrank 25 % or more, or left the data. */
export interface FindingChange {
  id: string;
  area: AreaId;
  change: ChangeKind;
  /** Yearly cents now; null when resolved or for a deadline. */
  midCents: number | null;
  /** Yearly cents in the last snapshot; null when new or for a deadline. */
  previousCents: number | null;
}

/** A finding's mid that moved this share or more is grown or shrunk. */
export const CHANGE_SHARE = 0.25;

/** The active findings of the page once each: the areas' cards and Seuraavat 60 päivää. */
export function shownFindings(data: Pick<OptimiseData, "areas" | "soon">): Finding[] {
  const out = new Map<string, Finding>();
  for (const f of [...data.areas.flatMap((a) => a.findings), ...data.soon]) if (!out.has(f.id)) out.set(f.id, f);
  return [...out.values()];
}

/**
 * The month's snapshot: every finding the page shows, decided or not, and the snoozed decisions, so a hidden one never
 * reads as resolved. A done finding keeps the mid it was decided at.
 */
export function snapshotOf(data: OptimiseData, states: readonly FindingState[]): SnapshotEntry[] {
  const out = new Map<string, SnapshotEntry>();
  const add = (entry: SnapshotEntry) => {
    if (!out.has(entry.id)) out.set(entry.id, entry);
  };
  for (const f of shownFindings(data)) add({ id: f.id, area: f.area, midCents: f.euros?.midCents ?? null, certainty: f.certainty.level, status: "active" });
  for (const { state, finding } of data.done) {
    const area = finding?.area ?? parseFindingId(state.findingId)?.area;
    if (area) add({ id: state.findingId, area, midCents: state.midCents ?? finding?.euros?.midCents ?? null, certainty: finding?.certainty.level ?? null, status: "done" });
  }
  for (const { finding } of data.dismissed) add({ id: finding.id, area: finding.area, midCents: finding.euros?.midCents ?? null, certainty: finding.certainty.level, status: "dismissed" });
  for (const s of states) {
    const area = parseFindingId(s.findingId)?.area;
    if (s.status === "snoozed" && s.until !== null && s.until > data.today && area) add({ id: s.findingId, area, midCents: s.midCents, certainty: null, status: "snoozed" });
  }
  return [...out.values()];
}

const STATUSES: readonly string[] = ["active", "done", "dismissed", "snoozed"];
const LEVELS: readonly string[] = ["korkea", "keskitaso", "matala"];
const isCents = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isSafeInteger(v));

/** A stored snapshot read back: entries that do not have the shape are left out, so a damaged row never breaks the page. */
export function parseSnapshot(raw: unknown): SnapshotEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e): SnapshotEntry[] => {
    if (typeof e !== "object" || e === null) return [];
    const { id, area, midCents, certainty, status } = e as Record<string, unknown>;
    if (typeof id !== "string" || !parseFindingId(id) || !(AREA_IDS as readonly unknown[]).includes(area) || !isCents(midCents)) return [];
    if (!(certainty === null || LEVELS.includes(certainty as string)) || !STATUSES.includes(status as string)) return [];
    return [{ id, area: area as AreaId, midCents, certainty: certainty as CertaintyLevel | null, status: status as SnapshotStatus }];
  });
}

const ORDER: readonly ChangeKind[] = ["new", "grown", "shrunk", "resolved"];

/**
 * Active findings now against the last snapshot. The page shows every finding, so one that appears is new and one that
 * leaves is resolved.
 */
export function changesSince(previous: readonly SnapshotEntry[], current: readonly SnapshotEntry[]): FindingChange[] {
  const before = new Map(previous.map((e) => [e.id, e]));
  const now = new Map(current.map((e) => [e.id, e]));
  const out: FindingChange[] = [];
  for (const e of current) {
    if (e.status !== "active") continue;
    const then = before.get(e.id);
    if (!then) {
      out.push({ id: e.id, area: e.area, change: "new", midCents: e.midCents, previousCents: null });
      continue;
    }
    if (then.status !== "active" || then.midCents === null || e.midCents === null || then.midCents <= 0) continue;
    if (e.midCents >= then.midCents * (1 + CHANGE_SHARE)) out.push({ id: e.id, area: e.area, change: "grown", midCents: e.midCents, previousCents: then.midCents });
    else if (e.midCents <= then.midCents * (1 - CHANGE_SHARE)) out.push({ id: e.id, area: e.area, change: "shrunk", midCents: e.midCents, previousCents: then.midCents });
  }
  for (const e of previous) {
    if (e.status === "active" && !now.has(e.id)) out.push({ id: e.id, area: e.area, change: "resolved", midCents: null, previousCents: e.midCents });
  }
  return out.sort((a, b) => ORDER.indexOf(a.change) - ORDER.indexOf(b.change) || (b.midCents ?? b.previousCents ?? 0) - (a.midCents ?? a.previousCents ?? 0) || a.id.localeCompare(b.id));
}
