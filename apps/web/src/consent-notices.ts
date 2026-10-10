import type { Account, Connection } from "./types.ts";

/** Notices start this many days before a consent ends. */
const WARN_DAYS = 14;

export interface ConsentNotice {
  /** The connection the notice is about. */
  id: string;
  institution: string;
  kind: "expired" | "expiring";
  daysLeft: number | null;
}

/**
 * One notice per connection that has ended or ends within two weeks, expired ones first and then the soonest.
 * A consent that expired has an own notice whatever the other consents are. Linking again moves the accounts to the
 * new consent and leaves the old record behind as expired, so an expired consent without accounts says nothing.
 */
export function consentNotices(connections: readonly Connection[], accounts: readonly Pick<Account, "connectionId">[]): ConsentNotice[] {
  const used = new Set(accounts.map((a) => a.connectionId));
  const expired = connections
    .filter((c) => c.status === "expired" && used.has(c.id))
    .map((c): ConsentNotice => ({ id: c.id, institution: c.institution, kind: "expired", daysLeft: c.daysLeft }));
  const expiring = connections
    .filter((c) => c.status === "active" && c.daysLeft !== null && c.daysLeft <= WARN_DAYS)
    .sort((a, b) => a.daysLeft! - b.daysLeft!)
    .map((c): ConsentNotice => ({ id: c.id, institution: c.institution, kind: "expiring", daysLeft: c.daysLeft }));
  return [...expired, ...expiring];
}

/** The connection stays active through its last day, so 0 means today. */
export function expiresIn(daysLeft: number): string {
  return daysLeft <= 0 ? "tänään" : daysLeft === 1 ? "huomenna" : `${daysLeft} päivän päästä`;
}

export function consentNoticeText(n: ConsentNotice): string {
  return n.kind === "expired" ? `${n.institution}-yhteys on vanhentunut.` : `${n.institution}-yhteys vanhenee ${expiresIn(n.daysLeft ?? 0)}.`;
}
