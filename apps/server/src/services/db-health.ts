/**
 * What an admin is told while it can still be mended: a disk that fills and a host helper that stopped. Each is one
 * notice, worked out when the notice list is read (services/security.ts); nothing here has a table, and nothing
 * watches row counts or the database's size, which every normal import changes.
 */
import { MB, type Statfs } from "../db/backup-keep.ts";
import type { Services } from "./context.ts";
import { diskState, RESERVE_WRITE_ABOVE } from "./disk.ts";
import { HELPER_SEEN_KEY, helperStatus } from "./ops-validate.ts";
import type { Notice } from "./security.ts";

const WHERE = "Asetukset > Palvelin ja ylläpito";

/** Tests put a made disk in place of the real one. */
export interface HealthProbes {
  statfs?: Statfs;
}

// ── the notices ──────────────────────────────────────────

type Kind = "disk_low" | "helper_silent";

interface Condition {
  kind: Kind;
  text: string;
}

/** What is wrong now. Reads files and settings and writes nothing. */
async function conditions(s: Services, probes: HealthProbes = {}): Promise<Condition[]> {
  const disk = diskState(s, probes.statfs);
  const diskLow = (disk.freeBytes !== null && disk.freeBytes < RESERVE_WRITE_ABOVE) || disk.reserve === "released";
  const helperSeen = await s.settings.get(HELPER_SEEN_KEY);

  const out: Condition[] = [];
  if (diskLow) out.push({ kind: "disk_low", text: `Palvelimen levyllä on enää ${Math.floor((disk.freeBytes ?? 0) / MB)} Mt vapaata tilaa. Siivoa levy kohdassa ${WHERE}.` });
  // "stale" is the helper's own word for it (ops-validate.ts): seen once, and not for 24 hours
  if (helperSeen && helperStatus(helperSeen, s.now()).reason === "stale") {
    out.push({ kind: "helper_silent", text: `Ylläpitoapurista ei ole kuulunut vuorokauteen. Käynnistä se palvelimella uudelleen: ohje on kohdassa ${WHERE}.` });
  }
  return out;
}

/**
 * The notices of an admin about the disk and the helper. Each stays while its condition holds and goes when it ends:
 * nobody marks one as read. Others get none.
 */
export async function healthNotices(s: Services, user: { id: string; role: string }, probes?: HealthProbes): Promise<Notice[]> {
  if (user.role !== "admin") return [];
  return (await conditions(s, probes)).map((c) => ({ id: c.kind, kind: c.kind, at: null, text: c.text }));
}
