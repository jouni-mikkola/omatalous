// Decision: connect or fetch what is missing before trusting a number
import { expiresIn } from "../consent-notices.ts";
import { date, dateTime, plural } from "../format.ts";
import type { Account, Connection, Meta, Scope } from "../types.ts";
import "../styles/quality.css";

/** The accounts the numbers are made of: the user's own, and with the household view the ones shared with them. */
export function accountsInNumbers(meta: Meta, scope: Scope): (Account & { ownerName?: string })[] {
  return scope === "household" ? [...meta.accounts, ...meta.sharedAccounts] : meta.accounts;
}

/** When the account was last fetched or imported; a balance typed in by hand counts as an import. */
export function lastFetched(account: Pick<Account, "lastSyncedAt" | "balanceAt">): string | null {
  return account.lastSyncedAt ?? account.balanceAt;
}

/** What the bank consent behind an account says: when it ends, or that it already has. Null for an account without a bank connection. */
export function consentText(connection: Connection | undefined): { text: string; urgent: boolean } | null {
  if (!connection) return null;
  if (connection.status === "revoked") return { text: "Yhteys on peruttu", urgent: true };
  if (connection.status === "expired") return { text: `Yhteys on vanhentunut${connection.validUntil ? ` ${date(connection.validUntil)}` : ""}`, urgent: true };
  if (!connection.validUntil) return { text: "Yhteys on voimassa", urgent: false };
  const left = connection.daysLeft;
  return { text: `Yhteys päättyy ${date(connection.validUntil)}${left === null ? "" : `, ${expiresIn(left)}`}`, urgent: left !== null && left <= 14 };
}

/**
 * One line that says what the numbers rest on: how many accounts, when they were last fetched, how many data quality
 * notes there are, and a way to the list. `signals` is the length of the data quality report, or null when the page
 * does not have it.
 */
export function DataScope({ meta, scope = "own", signals }: { meta: Meta; scope?: Scope; signals: number | null }) {
  const accounts = accountsInNumbers(meta, scope);
  const fetched = accounts.map(lastFetched).filter((x): x is string => x !== null).sort();
  const latest = fetched[fetched.length - 1];
  return (
    <p className="data-scope">
      <span>{accounts.length ? `Mukana ${plural(accounts.length, "tili", "tiliä")}` : "Ei yhtään tiliä mukana"}</span>
      {accounts.length > 0 && <span>{latest ? `haettu viimeksi ${dateTime(latest)}` : "ei vielä haettu"}</span>}
      {signals !== null && <span>{signals === 0 ? "ei huomautuksia tietojen laadusta" : `${plural(signals, "huomautus", "huomautusta")} tietojen laadusta`}</span>}
      <a href="#/reports">Tietojen laatu</a>
    </p>
  );
}
