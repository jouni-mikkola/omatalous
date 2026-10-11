import { date } from "./format.ts";
import type { Account, Connection } from "./types.ts";

/** Notices start this many days before a consent ends; the connections table offers a reconnect from then on. */
export const WARN_DAYS = 14;

/** The applications page of the Enable Banking Control Panel, where Link accounts is. */
export const CONTROL_PANEL = "https://enablebanking.com/cp/applications";

export interface ConsentNotice {
  /** The connection the notice is about, or for left_out the account. */
  id: string;
  institution: string;
  /**
   * lapsed: its date passed; broken: closed before its date; expiring: ends within two weeks; left_out: an account that
   * stayed on an ended consent while a newer consent of the bank is active.
   */
  kind: "lapsed" | "broken" | "expiring" | "left_out";
  /** The date a lapsed consent ended. */
  endedOn: string | null;
  daysLeft: number | null;
  /** The account a left_out notice is about. */
  accountName?: string;
}

/**
 * The words for an account a newer consent of its bank did not bring. Connecting again does not help until the
 * account is linked: a restricted application leaves the others out of a session.
 */
export function leftOutText(accountName: string): string {
  return `${accountName} ei tullut mukaan uuteen yhteyteen. Linkitä se Enable Bankingissa (API applications > Omatalous > Link accounts) ja yhdistä uudelleen.`;
}

/**
 * One notice per connection that has ended or ends within two weeks, ended ones first and then the soonest. A
 * consent that ended has its own notice whatever the other consents are. A connection that owns no account is
 * history (its accounts moved to a newer consent) and says nothing. An ended consent that a newer one of the same bank
 * replaced names each account still on it instead: "katkesi" with "Yhdistä uudelleen" would send the user round to
 * a reconnect that cannot move them.
 */
export function consentNotices(connections: readonly Connection[], accounts: readonly Pick<Account, "id" | "name" | "connectionId">[]): ConsentNotice[] {
  const current = connections.filter((c) => !c.history);
  const ended = current.filter((c) => c.state === "lapsed" || c.state === "broken" || (c.state === "removed" && c.replaced));
  const notices = ended.flatMap((c): ConsentNotice[] =>
    c.replaced
      ? accounts
          .filter((a) => a.connectionId === c.id)
          .map((a) => ({ id: a.id, institution: c.institution, kind: "left_out", endedOn: null, daysLeft: null, accountName: a.name }))
      : [{ id: c.id, institution: c.institution, kind: c.state === "lapsed" ? "lapsed" : "broken", endedOn: c.state === "lapsed" ? c.validUntil : null, daysLeft: null }],
  );
  const expiring = current
    .filter((c) => c.state === "active" && c.daysLeft !== null && c.daysLeft <= WARN_DAYS)
    .sort((a, b) => a.daysLeft! - b.daysLeft!)
    .map((c): ConsentNotice => ({ id: c.id, institution: c.institution, kind: "expiring", endedOn: null, daysLeft: c.daysLeft }));
  return [...notices, ...expiring];
}

/** The connection stays active through its last day, so 0 means today. */
export function expiresIn(daysLeft: number): string {
  return daysLeft <= 0 ? "tänään" : daysLeft === 1 ? "huomenna" : `${daysLeft} päivän päästä`;
}

/** The same words as the connections table and Tietojen laatu; a consent that broke shows no date. */
export function consentNoticeText(n: ConsentNotice): string {
  if (n.kind === "left_out") return leftOutText(n.accountName ?? n.institution);
  if (n.kind === "lapsed") return `${n.institution}-yhteys vanhentui${n.endedOn ? ` ${date(n.endedOn)}` : ""}.`;
  if (n.kind === "broken") return `${n.institution}-yhteys katkesi.`;
  return `${n.institution}-yhteys vanhenee ${expiresIn(n.daysLeft ?? 0)}.`;
}
