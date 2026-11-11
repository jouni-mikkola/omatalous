import { consentEnd, connectionState } from "../services/accounts.ts";
import type { Connection } from "../db/rows.ts";

const finnishDate = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;

/**
 * Why a consent ended, in the words the connections table uses: past its date it "vanhentui" on that date; closed
 * earlier by the bank or Enable Banking it "katkesi", and its date, still ahead, is not shown.
 */
export function endedMessage(conn: Connection, today: string, timezone: string): string {
  // the same date compare as the table, so the message and the Tila column never disagree
  const lapsed = connectionState({ status: "expired", validUntil: conn.validUntil }, today, timezone) === "lapsed";
  return lapsed
    ? `${conn.institution}: yhteys vanhentui ${finnishDate(consentEnd(conn.validUntil, timezone)!)}. Yhdistä uudelleen.`
    : `${conn.institution}: yhteys katkesi. Yhdistä uudelleen.`;
}

/** A key the source refuses fails every account with the same words: once is enough. */
export function say(summary: { messages: string[] }, message: string): void {
  if (!summary.messages.includes(message)) summary.messages.push(message);
}
