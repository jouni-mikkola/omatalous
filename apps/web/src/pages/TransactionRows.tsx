import { memo, useSyncExternalStore } from "react";
import { CategoryPicker } from "../components/CategorySelect.tsx";
import { date, dayMonth, money } from "../format.ts";
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

const WEEKDAY = ["su", "ma", "ti", "ke", "to", "pe", "la"];
/** "2026-10-12" gives "ma 12.10."; a day of another year than today's has the year too. */
export function dayHeading(iso: string, today: string): string {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${iso.slice(0, 4) === today.slice(0, 4) ? dayMonth(iso) : date(iso)}`;
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

export interface RowProps {
  t: TransactionItem;
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
  const detail = [t.counterparty, t.description].filter(Boolean).join(" · ");
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>{date(t.bookingDate)}</td>
      <td>
        <a href={`#/transactions?merchant=${encodeURIComponent(t.merchant)}`}>{t.merchant}</a>
        {t.status === "pending" && <span className="badge warn">varaus</span>}
        {t.isTransfer && <span className="badge">oma siirto</span>}
        <div className="sub" title={detail}>
          {detail || "–"} · {account}
        </div>
      </td>
      <td className="tx-category">
        <RowCategory {...row} />
      </td>
      <td className={`num ${t.amountCents > 0 ? "amount-in" : ""}`}>{money(t.amountCents)}</td>
    </tr>
  );
});

/** A phone row: the merchant and the amount, then the category. The day is the header above it. */
export const TxItem = memo(function TxItem(row: RowProps) {
  const { t } = row;
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
      </div>
    </li>
  );
});
