import { fold } from "@banking/core";
import { memo, useSyncExternalStore } from "react";
import { CategoryPicker } from "../components/CategorySelect.tsx";
import { date, money } from "../format.ts";
import { partAnchor } from "../part.ts";
import type { Category, TransactionItem } from "../types.ts";

// The rows of Tapahtumat: a table row for a wide screen, a two-line row under a day header for a phone.
// The page, its filters and its saving are in Transactions.tsx.

/** A phone gets day headers and two-line rows instead of the table. The width is the one transactions.css uses. */
const PHONE = "(max-width: 600px)";
const onPhoneChange = (notify: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener("change", notify);
  return () => m.removeEventListener("change", notify);
};
export function usePhone(): boolean {
  return useSyncExternalStore(onPhoneChange, () => window.matchMedia(PHONE).matches);
}

/** Rows are newest first, so the days are runs of equal booking dates. */
export function byDay(items: TransactionItem[]): { day: string; items: TransactionItem[] }[] {
  const days: { day: string; items: TransactionItem[] }[] = [];
  for (const t of items) {
    const last = days[days.length - 1];
    if (last?.day === t.bookingDate) last.items.push(t);
    else days.push({ day: t.bookingDate, items: [t] });
  }
  return days;
}

/** A row as /api/transactions gives it. In the own view a row of a joint account also carries the viewer's part of the bank's amount. */
export type ListedRow = TransactionItem & { partCents?: number };

/** The link of a row whose payer is not told: to the account's parts on Tilit, where the question is answered. null for a row with none open. */
export const ownerLink = (t: Pick<ListedRow, "openCents" | "accountId">): string | null => (t.openCents ? `#/settings#${partAnchor(t.accountId)}` : null);

/** The viewer's part of a joint account's row, told beside the bank's amount; null for a row that is all theirs. */
const partOfRow = (t: ListedRow): string | null => (t.partCents === undefined || t.partCents === t.amountCents ? null : `osuutesi ${money(t.partCents)}`);

/**
 * The bank's own text of a row (its payee and message), cut to what the payee's name does not already say: a part that
 * is the name in other letters ("ESIMERKKI OY" under "Esimerkki Oy") is left out. null when nothing is left.
 */
const bankText = (t: ListedRow): string | null => {
  const name = fold(t.merchant.trim());
  const parts = [t.counterparty, t.description].map((s) => s?.trim()).filter((s): s is string => !!s && fold(s) !== name);
  return parts.length ? parts.join(" · ") : null;
};

interface RowProps {
  t: ListedRow;
  categories: Category[];
  categoryLabel: string;
  pending: string | null;
  onCategory: (id: string, category: string) => void;
}

/** The category of a row, changeable in place, with the marks of where it came from. */
function RowCategory({ t, categories, categoryLabel, pending, onCategory, phone }: RowProps & { phone?: boolean }) {
  // the trade register entry is a hover title, which a phone has no use for
  const company = !phone && t.industry ? [t.industry.companyName, t.industry.businessId, t.industry.label].filter(Boolean).join(", ") : null;
  return (
    <>
      {t.own ? (
        <CategoryPicker categories={categories} value={pending ?? t.category} onChange={(c) => onCategory(t.id, c)} ariaLabel={`Kategoria: ${t.merchant}`} disabled={pending !== null} />
      ) : (
        <span title="Jaettu tili, vain omistaja voi muuttaa">{categoryLabel}</span>
      )}
      {t.categorySource === "user" && <span className="badge">käsin</span>}
      {t.categorySource === "match" && (
        <span className="badge" title="Palautus aiemmasta maksusta. Pienentää menoja, ei ole tuloa.">
          palautus
        </span>
      )}
      {company && (
        <span className="badge" title={company}>
          YTJ
        </span>
      )}
    </>
  );
}

export const TxRow = memo(function TxRow({ account, ...row }: RowProps & { account: string }) {
  const { t } = row;
  const text = bankText(t);
  const part = partOfRow(t);
  const owner = ownerLink(t);
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>{date(t.bookingDate)}</td>
      <td>
        <a href={`#/transactions?merchant=${encodeURIComponent(t.merchant)}`}>{t.merchant}</a>
        {t.status === "pending" && <span className="badge warn">varaus</span>}
        {t.isTransfer && <span className="badge">oma siirto</span>}
        <div className="tx-under">
          {text && (
            <span className="tx-text" title={text}>
              {text}
            </span>
          )}
          <span className="tx-account-under">{account}</span>
        </div>
      </td>
      <td className="tx-account">{account}</td>
      <td className="tx-category">
        <RowCategory {...row} />
      </td>
      <td className={`num ${t.amountCents > 0 ? "amount-in" : ""}`}>
        {money(t.amountCents)}
        {part && <div className="sub tx-part">{part}</div>}
        {owner && (
          <div className="sub tx-part">
            <a href={owner}>Kenen?</a>
          </div>
        )}
      </td>
    </tr>
  );
});

/** A phone row: the merchant and the amount, then the category. The day is the header above it. */
export const TxItem = memo(function TxItem(row: RowProps) {
  const { t } = row;
  const part = partOfRow(t);
  const owner = ownerLink(t);
  return (
    <li className="tx-item">
      <div className="tx-main">
        <a href={`#/transactions?merchant=${encodeURIComponent(t.merchant)}`}>{t.merchant}</a>
        {t.status === "pending" && <span className="badge warn">varaus</span>}
        {t.isTransfer && <span className="badge">oma siirto</span>}
        <span className={`tx-amount ${t.amountCents > 0 ? "amount-in" : ""}`}>{money(t.amountCents)}</span>
      </div>
      <div className="tx-cat">
        <RowCategory {...row} phone />
        {part && <span className="tx-part">{part}</span>}
        {owner && (
          <a className="tx-part" href={owner}>
            Kenen?
          </a>
        )}
      </div>
    </li>
  );
});
