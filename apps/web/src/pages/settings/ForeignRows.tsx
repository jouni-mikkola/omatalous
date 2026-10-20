/**
 * Asetukset > Tilit, under an account that has rows in another currency: per currency the count and the total in the
 * bank's own figure, and the newest rows. The euro pages leave these rows out, and no euro sign stands on them. The
 * server adds them up (`foreignRowsView`); this only draws them.
 */
import { formatForeignAmount } from "@banking/core";
import "../../styles/foreign-rows.css";

/** The answer of GET /api/foreign-rows for one account: a currency with its count, its total (null when the rows differ in decimals) and its newest rows. */
export interface ForeignCurrency {
  currency: string;
  count: number;
  totalMinor: number | null;
  scale: number | null;
  rows: { day: string; amountMinor: number; scale: number; text: string | null }[];
}

/** "2026-10-03" → "3.10.2026" */
const dayText = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;

/** A currency's code, or the words for a row whose currency the bank did not name (XXX). */
const codeText = (currency: string) => (currency === "XXX" ? "valuutta tuntematon" : currency);

export function ForeignRows({ currencies }: { currencies: readonly ForeignCurrency[] }) {
  return (
    <div className="acc-foreign">
      {currencies.map((c) => (
        <div key={c.currency} className="acc-foreign-currency">
          <div className="acc-foreign-head">
            <span className="acc-foreign-code">{codeText(c.currency)}</span>
            <span>{c.count === 1 ? "1 tapahtuma" : `${c.count} tapahtumaa`}</span>
            <span>yhteensä</span>
            <span className="num">{c.totalMinor === null || c.scale === null ? "–" : `${formatForeignAmount(c.totalMinor, c.scale, true)} ${c.currency}`}</span>
            <span>ei mukana euromäärissä</span>
          </div>
          <ul className="acc-foreign-rows">
            {c.rows.map((r, i) => (
              <li key={i}>
                <span>{dayText(r.day)}</span>
                <span className="acc-foreign-text">{r.text ?? ""}</span>
                <span className="num">{`${formatForeignAmount(r.amountMinor, r.scale, true)} ${c.currency}`}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
