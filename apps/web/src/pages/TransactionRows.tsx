import { fold, isCardBill, UNKNOWN_MERCHANT } from "@banking/core";
import { type ReactNode, useSyncExternalStore } from "react";
import { dayHeading, money } from "../format.ts";
import { t as msg, tn } from "../text.ts";
import { Why } from "../components/Why.tsx";
import { barShare } from "../components/table/cells.ts";
import { saveCsv, tableCsv } from "../components/table/csv.ts";
import { Button } from "../components/ui/Button.tsx";
import { type Column, Table, type TableView } from "../components/table/Table.tsx";
import { partAnchor } from "../part.ts";
import { settingsCardHash } from "../routes.ts";
import type { Category, Scope, TransactionItem } from "../types.ts";
import { CategoryLabel, CategoryMenu, SharedCategory } from "./transactions/CategoryChip.tsx";
import { AccountMark, type AccountLook } from "./transactions/Marks.tsx";
import { MerchantDrill } from "./transactions/MerchantDrill.tsx";
import { RowMenu } from "./transactions/RowMenu.tsx";
import { css } from "../css.ts";
// The rows of Tapahtumat: the shared table with a group for each day. A row says who, which account, which category and
// how much, and its one control is the chevron: it opens the row, which holds the row's one menu
// (the category and whether it becomes a rule, the payee's rows, the card bill's statement, whose share it is) and the payee's twelve months. The page, its filters and its saving are in Transactions.tsx.

/** The width under which the page floats its answers above the list (the width of the table's block layout). */
const PHONE = "(max-width: 600px)";
const onPhoneChange = (notify: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener("change", notify);
  return () => m.removeEventListener("change", notify);
};
export function usePhone(): boolean {
  return useSyncExternalStore(onPhoneChange, () => window.matchMedia(PHONE).matches);
}

/** How many rows the list asks the server for at once: one page of it. */
export const PAGE_ROWS = 100;
/** The page of the list the address names (`?page=2`), from 1; anything that is no whole number above 1 is the first. */
export const pageOf = (params: URLSearchParams): number => {
  const n = Number(params.get("page"));
  return Number.isSafeInteger(n) && n > 1 ? n : 1;
};

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
export const ownerLink = (t: Pick<ListedRow, "openCents" | "accountId">): string | null => (t.openCents ? settingsCardHash(partAnchor(t.accountId)) : null);

/**
 * The row's figure: the viewer's part where the server gives one (a joint account's row in the own view), else the bank's
 * amount. The day's sums (`daySums`) add up the same parts, so a day's rows add up to its header.
 */
const shownCents = (t: ListedRow): number => t.partCents ?? t.amountCents;
/** The bank's amount under a row whose figure is a part of it; null for a row that is all the viewer's. */
const wholeOfRow = (t: ListedRow): string | null => (t.partCents === undefined || t.partCents === t.amountCents ? null : msg("row.whole", { amount: signed(t.amountCents) }));
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

const cardBill = (t: ListedRow): boolean => isCardBill({ category: t.category, spend: -t.amountCents });

/** The statement of a card bill row: its explained sum and the way to open it. */
export interface StatementProps {
  explained?: number | null;
  onStatement?: (t: ListedRow) => void;
}

/** The quiet tags of a row: what the bank or the app says of it, in words, never by colour alone. "käsin" is the dot on the category chip, so it is not here. */
function Tags({ t, explained }: { t: ListedRow } & Pick<StatementProps, "explained">) {
  const company = t.industry ? [t.industry.companyName, t.industry.businessId, t.industry.label].filter(Boolean).join(", ") : null;
  return (
    <>
      {t.status === "pending" && <span className="tx-tag warn">{msg("row.tag_pending")}</span>}
      {t.isTransfer && <span className="tx-tag">{msg("row.tag_transfer")}</span>}
      {t.categorySource === "match" && (
        <span className="tx-tag" title={msg("row.tag_refund_title")}>
          {msg("row.tag_refund")}
        </span>
      )}
      {company && (
        <span className="tx-tag" title={company}>
          {msg("row.tag_register")}
        </span>
      )}
      {cardBill(t) && <span className="tx-tag">{explained ? msg("row.tag_itemised", { sum: money(explained) }) : msg("row.card_bill")}</span>}
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
  /** The rule a change of category makes for the payee's other rows: on or off, set where the category is picked. */
  remember?: boolean;
  onRemember?: (on: boolean) => void;
}

/** The row's figure is plain text; its basis belongs to the opened detail. */
function Amount({ t }: { t: ListedRow }) {
  return <span className={`tx-amount${t.amountCents > 0 ? " in" : ""}`}>{signed(shownCents(t))}</span>;
}

/** The bank's amount under the viewer's part; the way to name the payer is in the detail. */
function Part({ t }: { t: ListedRow }) {
  const whole = wholeOfRow(t);
  return <>{whole && <span className="tx-part">{whole}</span>}{ownerLink(t) && <span className="tx-part">{msg("row.no_split")}</span>}</>;
}

/** The payee's name as the reader sees it: a row with no payee is stored under one fixed word, shown in the reader's language. */
const nameOf = (t: Pick<ListedRow, "merchant">): string => (t.merchant === UNKNOWN_MERCHANT ? msg("tx.unknown_merchant") : t.merchant);

/** The payee's name and the quiet tags; the bank's own text is the line under them. */
function Who({ t, explained }: { t: ListedRow } & Pick<StatementProps, "explained">) {
  const text = bankText(t);
  return (
    <span className="tx-who">
      <span className="tx-line">
        <span className="tx-name">{nameOf(t)}</span>
        <Tags t={t} explained={explained} />
      </span>
      {text && (
        <span className="sub tx-text" title={text}>
          {text}
        </span>
      )}
    </span>
  );
}

/** What the opened row holds: the category picker, the way to the payee's rows, the card bill's statement, and the payee's months. */
function Detail({ t, categories, pending, onCategory, onStatement, note, scope, remember, onRemember, look, account }: RowProps & { scope: Scope }) {
  const owner = ownerLink(t);
  const text = signed(shownCents(t));
  const shown = pending ?? t.category;
  const categoryLabel = categories.find((c) => c.id === shown)?.label ?? shown;
  const bank = bankText(t);
  return (
    <div className="tx-detail">
      {/* what a phone's row leaves out: the account with its digits and the bank's own text */}
      <p className="tx-detail-facts">
        <span>{msg("row.account")}: {account}{look?.short.startsWith("••") ? ` ${look.short}` : ""}</span>
        {bank && <span className="sub">{bank}</span>}
      </p>
      <div className="tx-detail-acts">
        {!t.own && <SharedCategory categories={categories} value={t.category} manual={t.categorySource === "user"} />}
        <RowMenu
          label={msg("row.actions", { name: nameOf(t) })}
          panel={
            t.own
              ? {
                  key: "category",
                  label: msg("row.category", { category: categoryLabel }),
                  ariaLabel: msg("row.category_now", { name: nameOf(t), category: categoryLabel }),
                  title: msg("row.category_of", { name: nameOf(t) }),
                  render: (close) => (
                    <CategoryMenu
                      categories={categories}
                      value={pending ?? t.category}
                      note={note}
                      onPick={(id) => {
                        close();
                        if (id !== (pending ?? t.category)) onCategory(t.id, id);
                      }}
                    />
                  ),
                }
              : null
          }
          toggles={t.own && onRemember ? [{ key: "remember", label: msg("row.remember"), checked: remember ?? true, onChange: onRemember }] : []}
          items={[
            { key: "all", label: msg("row.all_of", { name: nameOf(t) }), href: `#/transactions?merchant=${encodeURIComponent(t.merchant)}` },
            ...(cardBill(t) && t.own && onStatement ? [{ key: "statement", label: msg("row.itemise"), onAction: () => onStatement(t) }] : []),
            ...(owner ? [{ key: "owner", label: msg("row.whose"), href: owner }] : []),
          ]}
        />
        {wholeOfRow(t) && shownCents(t) !== 0 && (
          <span>{msg("row.your_share")}: <Why figure="share.part" title={msg("row.your_share")} range={{ from: t.bookingDate, to: t.bookingDate }} scope="own" row={t.id} account={t.accountId} text={text}>{text}</Why></span>
        )}
      </div>
      <MerchantDrill merchant={t.merchant} scope={scope} />
    </div>
  );
}

/** The toolbar's chips: rows the reader or the bank has marked. The table counts them in the rows it has. */
export const rowChips = () => [
  { key: "manual", label: msg("row.chip_manual"), test: (t: ListedRow) => t.categorySource === "user" },
  { key: "pending", label: msg("row.chip_pending"), test: (t: ListedRow) => t.status === "pending" },
];

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

/**
 * The list: a day is a group, its row says the day, how many rows it has in the filter and what they add up to (the
 * server's), and the bars of its amounts are drawn against its largest. The rows stay newest first as the server sends
 * them. The toolbar's grouping puts the same rows under their payee instead. An opened row shows its payee's twelve months under it.
 */
export function TxTable({ items, whole = true, allRows, severalAccounts, today, daySums, rowProps, scope, open, onOpen, view, onView, filters, searchLabel }: { items: ListedRow[]; /** The rows are all the filter has (the default). A page of a longer list offers every chip (a row with the mark can be on another page), and its CSV link fetches the other pages too (`allRows`; null when they did not come). */ whole?: boolean; allRows?: () => Promise<ListedRow[] | null>; /** The account column says which account only where there is a choice of them. */ severalAccounts: boolean; today: string; daySums: Map<string, DaySum>; rowProps: (t: ListedRow) => RowProps; scope: Scope; open: string | null; onOpen: (id: string | null) => void; view: TableView; onView: (next: TableView) => void; filters: ReactNode; searchLabel: string }) {
  const days = byDay(items);
  const maxOf = new Map(days.flatMap((d) => d.items.map((t) => [t.id, dayMax(d.items)] as const)));
  const columns: Column<ListedRow>[] = [
    { key: "who", label: msg("row.who"), kind: "text", rowHead: true, csv: (t) => t.merchant, group: nameOf, cell: (t) => <Who t={t} explained={rowProps(t).explained} /> },
    ...(severalAccounts ? [{ key: "account", label: msg("row.account"), kind: "text" as const, className: () => "tx-account", headClass: "tx-account", cell: (t: ListedRow) => <AccountMark look={rowProps(t).look} fallback={rowProps(t).account} /> }] : []),
    // a chip is for a mark some row has: "Varaukset 0" filters to nothing
    { key: "category", label: msg("row.category_col"), kind: "text", chips: rowChips().filter((c) => !whole || items.some(c.test)), className: () => "tx-category", headClass: "tx-category", cell: (t) => <CategoryLabel categories={rowProps(t).categories} value={rowProps(t).pending ?? t.category} manual={t.categorySource === "user"} /> },
    {
      key: "amount",
      label: msg("table.amount"),
      kind: "money",
      main: true,
      csv: (t) => shownCents(t) / 100,
      cell: (t) => {
        const share = !t.isTransfer && maxOf.get(t.id) ? barShare(Math.abs(shownCents(t)), maxOf.get(t.id)!) : 0;
        return (
          <>
            <Amount t={t} />
            <Part t={t} />
            {share > 0 && (
              <span className={`tx-bar${t.amountCents > 0 ? " in" : ""}`} aria-hidden="true">
                <span ref={css({ "inline-size": `${(share * 100).toFixed(1)}%` })} />
              </span>
            )}
          </>
        );
      },
    },
  ];
  const caption = msg("row.transactions");
  // the file of a paged list: every row of the filter by its day, as the table's own file of a whole list has them
  const saveAll = async () => {
    const rows = await allRows?.();
    if (rows) saveCsv(caption, tableCsv(columns, rows, byDay(rows).map((d) => ({ key: d.day, title: d.day, rows: d.items }))));
  };
  return (
    <>
    <Table<ListedRow>
      caption={caption}
      className="tx-table"
      rows={items}
      rowKey={(t) => t.id}
      columns={columns}
      groups={days.map((d) => {
        const sum = daySums.get(d.day);
        return {
          key: d.day,
          title: (
            <>
              {dayHeading(d.day, today)}
              <span className="rt-group-count">{tn(sum?.count ?? d.items.length, "row.day_one", "row.day_many")}</span>
            </>
          ),
          figure: <DaySums sum={sum} />,
          figureSpan: 2,
          csv: d.day,
          rows: d.items,
        };
      })}
      open={open}
      onOpen={onOpen}
      drill={(t) => <Detail {...rowProps(t)} scope={scope} />}
      drillLabel={(r) => msg("row.open_months", { name: nameOf(r) })}
      csv={whole}
      rowsSearched
      searchLabel={searchLabel}
      toolbarExtra={filters}
      view={view}
      onView={onView}
    />
    {!whole && allRows && (
      <p className="rt-csv">
        <Button variant="link" onClick={() => void saveAll()}>
          {msg("table.csv")}
        </Button>
      </p>
    )}
    </>
  );
}

/** The table before the first answer: a day's row and four rows, grey bars where the payee and the figure will stand. */
export function RowsSkeleton() {
  return (
    <div className="tx-skel-rows" role="status" aria-live="polite">
      <span className="sr-only">{msg("load.loading")}</span>
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
