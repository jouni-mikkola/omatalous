/**
 * The words of the bank connection list that need no component: the callback's error reasons, the Tila and Päivitetty
 * texts of a consent, the notice after a finished consent and which bank a renewal starts.
 */
import { bankIdForInstitution } from "../../banks.ts";
import { date, dateTime, localDay } from "../../format.ts";
import type { Account, BankOption, Connection } from "../../types.ts";
import { labelTable, t, tn } from "../../text.ts";

/**
 * The bank callback sends only these codes (routes/bank.ts). The link reasons have the same words as LINK_FAILURES in
 * the server's connectors/link-state.ts, which a pasted address gets; anything else reads as "failed".
 */
export const CONNECT_ERRORS: Record<string, string> = labelTable({
  session: () => t("set.conn.the_sign_in_expired_sign"),
  setup: () => t("set.conn.bank_connections_are_not_in"),
  failed: () => t("set.conn.connecting_failed_try_again"),
  cancelled: () => t("set.conn.connecting_was_cancelled"),
  bank: () => t("set.conn.the_bank_cancelled_the_connection"),
  inactive: () => t("set.conn.enable_banking_does_not_yet"),
  app: () => t("set.conn.enable_banking_did_not_recognise"),
  refused: () => t("set.conn.enable_banking_refused_the_connection"),
  expired: () => t("set.conn.the_connection_expired_try_again"),
});

/** hasOwn: the code comes from the address bar, so "constructor" must not find an inherited value. */
export function connectError(code: string): string {
  return Object.hasOwn(CONNECT_ERRORS, code) ? CONNECT_ERRORS[code]! : CONNECT_ERRORS.failed!;
}

/** The Tila column: the same words as the notice and Tietojen laatu, and no date ahead for a consent that broke or ended before its date. */
export function connectionStateText(c: Pick<Connection, "state" | "validUntil">, today = ""): string {
  // an end marked before its date is no "vanhentui" with a date ahead
  if (c.state === "lapsed") return today && (c.validUntil ? localDay(c.validUntil) : "") > today ? t("set.conn.ended") : t("set.conn.expired_on", { date: date(c.validUntil) });
  if (c.state === "broken") return t("set.conn.broken");
  if (c.state === "removed") return t("set.conn.removed");
  return t("set.conn.in_use");
}

/** A consent that ended and has no newer one of its bank: Yhdistä uudelleen is the next step, and the row says why. */
export function renewalLine(c: Pick<Connection, "needsRenewal" | "replaced">): string | null {
  return c.needsRenewal && !c.replaced ? t("set.conn.the_bank_connection_ended") : null;
}

/**
 * The Päivitetty column: when the accounts of a consent were last fetched, or, while none was, why. A consent that ended
 * keeps the date of its last run.
 */
export function fetchedText(conn: Pick<Connection, "id" | "state" | "lastSyncedAt">, accounts: readonly Pick<Account, "connectionId" | "lastSyncedAt" | "problem">[]): string {
  const own = accounts.filter((a) => a.connectionId === conn.id);
  const last = own.reduce<string | null>((late, a) => (a.lastSyncedAt && (!late || a.lastSyncedAt > late) ? a.lastSyncedAt : late), null);
  if (last) return dateTime(last);
  if (conn.state !== "active" || !own.length) return dateTime(conn.lastSyncedAt);
  if (own.some((a) => a.problem?.kind === "not_linked")) return t("set.conn.not_added_in_the_control");
  if (own.some((a) => a.problem?.kind === "failed")) return t("set.conn.fetch_failed");
  return t("set.conn.waiting_for_the_first_fetch");
}

/**
 * The notice after a finished consent, from the callback or the pasted
 * address. Zero accounts is a warning: no transactions will ever come
 * until the accounts are linked in Enable Banking.
 */
export function connectedMessage(accounts: number): { tone: "good" | "warning"; text: string } {
  return accounts > 0
    ? { tone: "good", text: t("set.conn.connected", { accounts: tn(accounts, "set.conn.account_one", "set.conn.account_many") }) }
    : { tone: "warning", text: t("set.conn.the_bank_gave_no_accounts") };
}

/**
 * What a renewal starts: the consent's own bank at once, found by the name the bank reported. Null opens the picker:
 * the bank is no longer offered, or no application can start a bank yet.
 */
export function renewalBank(banks: readonly BankOption[], institution: string, canStart: boolean): string | null {
  return canStart ? bankIdForInstitution(banks, institution) : null;
}
