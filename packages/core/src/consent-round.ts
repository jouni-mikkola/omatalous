/**
 * Decision: which bank consents the household renews now, and in the round already begun, which consents are done and
 * which are left. One definition, read by the server (what a round stores and answers) and the web (the notices).
 * The round counts consents, not banks: Nordea gives one account per consent, so a household has several of one bank.
 */

/** A consent counts as ending this many days before its date; the notices and the round start from then on. */
export const WARN_DAYS = 14;

/** What the round reads of a consent (the server's connection view). */
export interface RoundConnection {
  id: string;
  institution: string;
  state: "active" | "lapsed" | "broken" | "removed";
  /** Owns no account: its accounts moved to a newer consent, so it says nothing. */
  history: boolean;
  /** Not active, and a newer consent of the same bank is. */
  replaced: boolean;
  /** Days to the end date of an active consent, else null. */
  daysLeft: number | null;
}

/** A consent to renew and the registry bank that starts its renewal. */
export interface RoundConsent {
  connection: string;
  bank: string;
}

/** What a begun round keeps: when it began and the consents it renews. */
export interface StoredRound {
  startedAt: string;
  consents: RoundConsent[];
}

interface RoundItem extends RoundConsent {
  done: boolean;
}

export interface RoundView {
  consents: RoundItem[];
  /** Every consent is done. */
  finished: boolean;
}

/** Ended with no newer consent of its bank, or active and ending within WARN_DAYS. */
function dueRank(c: RoundConnection): number | null {
  if (c.history) return null;
  if (c.state === "lapsed" || c.state === "broken") return c.replaced ? null : -1;
  return c.state === "active" && c.daysLeft !== null && c.daysLeft <= WARN_DAYS ? c.daysLeft : null;
}

/**
 * The consents to renew, ended ones first and then the soonest to end. `bankOf` names the registry bank of a consent's
 * institution, or null; a bank outside `startable` cannot be started by id and is left to the picker.
 */
export function dueConsents(connections: readonly RoundConnection[], bankOf: (institution: string) => string | null, startable: ReadonlySet<string>): RoundConsent[] {
  const due: { rank: number; consent: RoundConsent }[] = [];
  for (const c of connections) {
    const rank = dueRank(c);
    const bank = rank === null ? null : bankOf(c.institution);
    if (rank !== null && bank && startable.has(bank)) due.push({ rank, consent: { connection: c.id, bank } });
  }
  return due.sort((a, b) => a.rank - b.rank).map((d) => d.consent);
}

/**
 * A consent is done once it is no longer due: a newer consent took its accounts, it was replaced or removed. One that
 * is still due after its bank was renewed (the bank gave other accounts) stays left, and the next press is its own.
 */
export function roundView(round: StoredRound, connections: readonly RoundConnection[]): RoundView {
  const consents = round.consents.map((r) => {
    const c = connections.find((o) => o.id === r.connection);
    return { ...r, done: !c || dueRank(c) === null };
  });
  return { consents, finished: consents.every((c) => c.done) };
}
