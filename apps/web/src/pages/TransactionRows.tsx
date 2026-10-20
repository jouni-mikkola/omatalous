import { fold, isCardBill } from "@banking/core";
import { Fragment, memo, useState, useSyncExternalStore } from "react";
import { dayHeading, money, plural } from "../format.ts";
import { Why } from "../components/Why.tsx";
import { ExtensionRowParts } from "../components/ExtensionRowParts.tsx";
import { SortHead } from "../components/table/Cells.tsx";
import { barShare } from "../components/table/cells.ts";
import { nextSort, type Sort, sortRows } from "../components/table/sort.ts";
import { type Density, RichTable } from "../components/table/RichTable.tsx";
import { partAnchor } from "../part.ts";
import type { Category, Scope, TransactionItem } from "../types.ts";
import { CategoryChip } from "./transactions/CategoryChip.tsx";
import { AccountMark, type AccountLook, PayeeMark } from "./transactions/Marks.tsx";
import { MerchantDrill } from "./transactions/MerchantDrill.tsx";

// The rows of Tapahtumat: a table row for a wide screen, a card under a day header for a phone. Both carry the same
// parts: the payee's mark, the account's plate and digits, the category chip, the amount with its bar, the drill.
// The page, its filters and its saving are in Transactions.tsx.

/** A phone gets day headers and card rows instead of the table. The width is the one transactions.css uses. */
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
export function byDay<T extends TransactionItem>(items: T[]): { day: string; items: T[] }[] {
  const days: { day: string; items: T[] }[] = [];
  for (const t of items) {
    const last = days[days.length - 1];
    if (last?.day === t.bookingDate) last.items.push(t);
    else days.push({ day: t.bookingDate, items: [t] });
  }
  return days;
}

/** What all the filter's rows of one day add up to, the server's (`daySums`), also on a day the page limit cuts. */
export interface DaySum {
  date: string;
  count: number;
  inCents: number;
  outCents: number;
}

/** A row as /api/transactions gives it. In the own view a row of a joint account also carries the viewer's part of the bank's amount. */
export type ListedRow = TransactionItem & { partCents?: number };

/** The link of a row whose payer is not told: to the account's parts on Tilit, where the question is answered. null for a row with none open. */
export const ownerLink = (t: Pick<ListedRow, "openCents" | "accountId">): string | null => (t.openCents ? `#/settings#${partAnchor(t.accountId)}` : null);

/**
 * The row's figure: the viewer's part where the server gives one (a joint account's row in the own view), else the bank's
 * amount. The day's sums (`daySums`) add up the same parts, so a day's rows add up to its header.
 */
const shownCents = (t: ListedRow): number => t.partCents ?? t.amountCents;
/** The bank's amount under a row whose figure is a part of it; null for a row that is all the viewer's. */
const wholeOfRow = (t: ListedRow): string | null => (t.partCents === undefined || t.partCents === t.amountCents ? null : `koko summa ${signed(t.amountCents)}`);
/** Money in wears its plus, as on the row's figure. */
const signed = (cents: number): string => (cents > 0 ? `+${money(cents)}` : money(cents));

/**
 * The bank's own text of a row (its payee and message), cut to what the payee's name does not already say: a part that
 * is the name in other letters ("ESIMERKKI OY" under "Esimerkki Oy") is left out. null when nothing is left.
 */
const bankText = (t: ListedRow): string | null => {
  const name = fold(t.merchant.trim());
  const parts = [t.counterparty, t.description].map((s) => s?.trim()).filter((s): s is string => !!s && fold(s) !== name);
  return parts.length ? parts.join(" · ") : null;
};

const CARD_BILL_LABEL = "Korttilasku: ostot eivät näy";
const cardBill = (t: ListedRow): boolean => isCardBill({ category: t.category, spend: -t.amountCents });
const isPerson = (t: ListedRow): boolean => t.category === "p2p" || t.category === "p2p_in";

/** The statement of a card bill row: its explained sum and the way to open it. */
export interface StatementProps {
  explained?: number | null;
  onStatement?: (t: ListedRow) => void;
}

/**
 * The quiet tags of a row: what the bank or the app says of it, in words, never by colour alone. "käsin" is the dot on
 * the category chip, so it is not here.
 */
/** `only`: a phone card puts the status words on the name's line and the card bill's words on the second. */
function Tags({ t, explained, onStatement, phone, only }: { t: ListedRow; phone?: boolean; only?: "status" | "bill" } & StatementProps) {
  const company = !phone && t.industry ? [t.industry.companyName, t.industry.businessId, t.industry.label].filter(Boolean).join(", ") : null;
  const status = only !== "bill";
  const bill = only !== "status" && cardBill(t);
  return (
    <>
      {status && t.status === "pending" && <span className="tx-tag warn">varaus</span>}
      {status && t.isTransfer && <span className="tx-tag">oma siirto</span>}
      {status && t.categorySource === "match" && (
        <span className="tx-tag" title="Palautus aiemmasta maksusta. Se pienentää menoja eikä ole tuloa.">
          palautus
        </span>
      )}
      {status && company && (
        <span className="tx-tag" title={company}>
          YTJ
        </span>
      )}
      {bill && <span className="tx-tag">{explained ? `ostoja eritelty ${money(explained)}` : CARD_BILL_LABEL}</span>}
      {bill && t.own && onStatement && (
        <button className="tx-tag tx-tag-act" type="button" aria-label={`Erittele ostot: ${t.merchant}`} onClick={() => onStatement(t)}>
          Erittele ostot
        </button>
      )}
    </>
  );
}

export interface RowProps extends StatementProps {
  t: ListedRow;
  categories: Category[];
  pending: string | null;
  onCategory: (id: string, category: string) => void;
  /** What a change of category does to the payee's other rows, said in the picker. */
  note?: string;
  look?: AccountLook;
  account: string;
  open?: boolean;
  onToggle?: (id: string) => void;
}

/** The row's figure; a part that is not nothing opens what it is cut from. */
function Amount({ t }: { t: ListedRow }) {
  const cents = shownCents(t);
  const text = signed(cents);
  return (
    <span className={`tx-amount${t.amountCents > 0 ? " in" : ""}`}>
      {wholeOfRow(t) && cents !== 0 ? (
        <Why figure="share.part" title="Osuutesi" range={{ from: t.bookingDate.slice(0, 10), to: t.bookingDate.slice(0, 10) }} scope="own" row={t.id} account={t.accountId} text={text}>
          {text}
        </Why>
      ) : (
        text
      )}
    </span>
  );
}

/** A joint account's row: the bank's amount under the viewer's part, or the way to say who paid it. */
function Part({ t }: { t: ListedRow }) {
  const whole = wholeOfRow(t);
  const owner = ownerLink(t);
  return (
    <>
      {whole && <span className="tx-part">{whole}</span>}
      {owner && (
        <a className="tx-part" href={owner}>
          Kenen?
        </a>
      )}
    </>
  );
}

const Chevron = ({ open, merchant, onToggle, id }: { open?: boolean; merchant: string; onToggle?: (id: string) => void; id: string }) =>
  onToggle ? (
    <button type="button" className="tx-open" aria-expanded={!!open} aria-label={`${open ? "Sulje" : "Avaa"} ${merchant}: 12 kuukautta`} onClick={() => onToggle(id)}>
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 4.5 6 7.5 9 4.5" />
      </svg>
    </button>
  ) : null;

const Payee = ({ t }: { t: ListedRow }) => (
  <>
    <PayeeMark name={t.merchant} person={isPerson(t)} />
    <a className="tx-name" href={`#/transactions?merchant=${encodeURIComponent(t.merchant)}`}>
      {t.merchant}
    </a>
  </>
);

const Chip = ({ t, categories, pending, note, onCategory }: Pick<RowProps, "t" | "categories" | "pending" | "note" | "onCategory">) => (
  <CategoryChip categories={categories} value={t.category} pending={pending} merchant={t.merchant} note={note} manual={t.categorySource === "user"} onPick={t.own ? (c) => onCategory(t.id, c) : undefined} />
);

/**
 * A wide row on one line: the payee and its tags, then the bank's own text cut by the cell. The day is its group's row
 * above it; `max` is the day's largest listed amount, which the bar under the figure is drawn against. What the build's
 * extensions add stands under the line.
 */
export const TxRow = memo(function TxRow({ t, categories, pending, onCategory, note, look, account, explained, onStatement, open, onToggle, max }: RowProps & { max?: number }) {
  const text = bankText(t);
  const share = !t.isTransfer && max ? barShare(Math.abs(shownCents(t)), max) : 0;
  return (
    <tr className={open ? "tx-opened" : undefined}>
      <td className="tx-who">
        <div className="tx-line">
          <Payee t={t} />
          {/* a tablet has no account column: the mark stands on the payee's line */}
          <span className="tx-line-acct">
            <AccountMark look={look} fallback={account} />
          </span>
          <Tags t={t} explained={explained} onStatement={onStatement} />
          <ExtensionRowParts row={t} mark />
          {text && (
            <span className="tx-text" title={text}>
              {text}
            </span>
          )}
        </div>
        <ExtensionRowParts row={t} />
      </td>
      <td className="tx-account">
        <AccountMark look={look} fallback={account} />
      </td>
      <td className="tx-category">
        <Chip t={t} categories={categories} pending={pending} note={note} onCategory={onCategory} />
      </td>
      <td className="num tx-sum">
        <Amount t={t} />
        {share > 0 && (
          <span className={`tx-bar${t.amountCents > 0 ? " in" : ""}`} aria-hidden="true">
            <span style={{ inlineSize: `${(share * 100).toFixed(1)}%` }} />
          </span>
        )}
        <Part t={t} />
      </td>
      <td className="tx-drillcell">
        <Chevron open={open} merchant={t.merchant} onToggle={onToggle} id={t.id} />
      </td>
    </tr>
  );
});

/** A phone row as a card of two lines: the mark, the payee and the amount, then the category chip, the account and the tags. */
export const TxItem = memo(function TxItem({ t, categories, pending, onCategory, note, look, account, explained, onStatement, open, onToggle, scope }: RowProps & { scope?: Scope }) {
  return (
    <li className={`tx-item${open ? " tx-opened" : ""}`}>
      <div className="tx-main">
        <span className="tx-line">
          <Payee t={t} />
          <Tags t={t} phone only="status" />
        </span>
        <Amount t={t} />
      </div>
      <div className="tx-cat">
        <Chip t={t} categories={categories} pending={pending} note={note} onCategory={onCategory} />
        <AccountMark look={look} fallback={account} />
        <Tags t={t} explained={explained} onStatement={onStatement} phone only="bill" />
        <Part t={t} />
        <ExtensionRowParts row={t} mark />
        <Chevron open={open} merchant={t.merchant} onToggle={onToggle} id={t.id} />
      </div>
      <ExtensionRowParts row={t} />
      {open && <MerchantDrill merchant={t.merchant} scope={scope ?? "own"} />}
    </li>
  );
});

/** A day's sums in its group row: what went out and what came in, own transfers left out; nothing for a day of transfers only. */
export function DaySums({ sum }: { sum: DaySum | undefined }) {
  if (!sum) return null;
  return (
    <>
      {sum.outCents > 0 && <span className="rt-sub">{money(-sum.outCents)}</span>}
      {sum.inCents > 0 && <span className="rt-sub rt-sub-in">+{money(sum.inCents)}</span>}
    </>
  );
}

/** The day's largest listed amount, own transfers left out: the length the bars of its rows are drawn against. */
const dayMax = (items: ListedRow[]): number => (items.length > 1 ? Math.max(0, ...items.filter((t) => !t.isTransfer).map((t) => Math.abs(shownCents(t)))) : 0);

/** The phone list: a day header with the day's sums, then its rows as cards. */
export function TxCards({ items, today, daySums, rowProps, scope }: { items: ListedRow[]; today: string; daySums: Map<string, DaySum>; rowProps: (t: ListedRow) => RowProps; scope: Scope }) {
  return (
    <>
      {byDay(items).map((d) => (
        <div key={d.day} className="tx-day">
          <div className="tx-day-head">
            <h3>{dayHeading(d.day, today)}</h3>
            <DaySums sum={daySums.get(d.day)} />
          </div>
          <ul>
            {d.items.map((t) => (
              <TxItem key={t.id} {...rowProps(t)} scope={scope} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

type SortKey = "payee" | "amount";
/** A press sorts a column (the payee from A, the amount largest first), a second press turns it, a third gives back the bank's order. */
const TEXT_KEYS: SortKey[] = ["payee"];

/** What a column sorts by: the payee's name, or the size of the amount whichever way it went. */
const sortValue = (key: SortKey) => (t: ListedRow) => (key === "payee" ? t.merchant : Math.abs(t.amountCents));

/**
 * The wide table: a day is a group, its row says the day, how many rows it has in the filter and what they add up to
 * (the server's), and the bars of its amounts are drawn against its largest. The rows stay newest first as the server
 * sends them; a sorted column orders the rows inside each day, and the days stay in their order. An opened row shows
 * its payee's twelve months under it.
 */
export function TxTable({ items, today, density, daySums, rowProps, scope }: { items: ListedRow[]; today: string; density: Density; daySums: Map<string, DaySum>; rowProps: (t: ListedRow) => RowProps; scope: Scope }) {
  const [sort, setSort] = useState<Sort<SortKey>>(null);
  const dirOf = (key: SortKey) => (sort?.key === key ? sort.dir : null);
  return (
    <RichTable density={density} className="tx-table" label="Tapahtumat">
      <thead>
        <tr>
          <SortHead label="Saaja tai maksaja" dir={dirOf("payee")} onSort={() => setSort((s) => nextSort(s, "payee", TEXT_KEYS))} />
          <th scope="col" className="tx-account">
            Tili
          </th>
          <th scope="col" className="tx-category">
            Kategoria
          </th>
          <SortHead label="Summa" numeric dir={dirOf("amount")} onSort={() => setSort((s) => nextSort(s, "amount", TEXT_KEYS))} />
          <th scope="col" className="tx-drillcell">
            <span className="sr-only">Avaa</span>
          </th>
        </tr>
      </thead>
      {byDay(items).map((d) => {
        const sum = daySums.get(d.day);
        const max = dayMax(d.items);
        const rows = sort ? sortRows(d.items, sortValue(sort.key), sort.dir) : d.items;
        return (
          <tbody key={d.day}>
            <tr className="rt-group">
              <th scope="rowgroup" colSpan={3}>
                {dayHeading(d.day, today)}
                <span className="rt-group-count">{plural(sum?.count ?? d.items.length, "tapahtuma", "tapahtumaa")}</span>
              </th>
              <td className="num" colSpan={2}>
                <DaySums sum={sum} />
              </td>
            </tr>
            {rows.map((t) => {
              const p = rowProps(t);
              return (
                <Fragment key={t.id}>
                  <TxRow {...p} max={max} />
                  {p.open && (
                    <tr className="tx-drill">
                      <td colSpan={5}>
                        <MerchantDrill merchant={t.merchant} scope={scope} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        );
      })}
    </RichTable>
  );
}

/** The table before the first answer: its head and rows at the chosen density, grey bars where the payee and the figure will stand. */
export function RowsSkeleton({ density }: { density: Density }) {
  return (
    <div className={`tx-skel-rows tx-skel-${density}`} role="status" aria-live="polite">
      <span className="sr-only">Ladataan…</span>
      <span className="tx-skel-group" aria-hidden="true">
        <span className="sk-bar sk-label" />
      </span>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="tx-skel-row" aria-hidden="true">
          <span className="sk-bar sk-name" />
          <span className="sk-bar sk-num" />
        </span>
      ))}
    </div>
  );
}
