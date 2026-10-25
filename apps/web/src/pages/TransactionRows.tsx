import { fold, isCardBill } from "@banking/core";
import { useSyncExternalStore } from "react";
import { dayHeading, money, plural } from "../format.ts";
import { Why } from "../components/Why.tsx";
import { ExtensionRowParts } from "../components/ExtensionRowParts.tsx";
import { barShare } from "../components/table/cells.ts";
import { type Column, Table } from "../components/table/Table.tsx";
import { partAnchor } from "../part.ts";
import type { Category, Scope, TransactionItem } from "../types.ts";
import { CategoryChip, CategoryLabel } from "./transactions/CategoryChip.tsx";
import { AccountMark, type AccountLook, PayeeMark } from "./transactions/Marks.tsx";
import { MerchantDrill } from "./transactions/MerchantDrill.tsx";

// The rows of Tapahtumat: the shared table with a group for each day. A row says who, which account, which category and
// how much, and its one control is the chevron: it opens the row, which holds the way to the payee's rows, the category
// picker and the payee's twelve months. The page, its filters and its saving are in Transactions.tsx.

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

/** The quiet tags of a row: what the bank or the app says of it, in words, never by colour alone. "käsin" is the dot on the category chip, so it is not here. */
function Tags({ t, explained }: { t: ListedRow } & Pick<StatementProps, "explained">) {
  const company = t.industry ? [t.industry.companyName, t.industry.businessId, t.industry.label].filter(Boolean).join(", ") : null;
  return (
    <>
      {t.status === "pending" && <span className="tx-tag warn">varaus</span>}
      {t.isTransfer && <span className="tx-tag">oma siirto</span>}
      {t.categorySource === "match" && (
        <span className="tx-tag" title="Palautus aiemmasta maksusta. Se pienentää menoja eikä ole tuloa.">
          palautus
        </span>
      )}
      {company && (
        <span className="tx-tag" title={company}>
          YTJ
        </span>
      )}
      {cardBill(t) && <span className="tx-tag">{explained ? `ostoja eritelty ${money(explained)}` : CARD_BILL_LABEL}</span>}
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
}

/** The row's figure is plain text; its basis belongs to the opened detail. */
function Amount({ t }: { t: ListedRow }) {
  return <span className={`tx-amount${t.amountCents > 0 ? " in" : ""}`}>{signed(shownCents(t))}</span>;
}

/** The bank's amount under the viewer's part; the way to name the payer is in the detail. */
function Part({ t }: { t: ListedRow }) {
  const whole = wholeOfRow(t);
  return <>{whole && <span className="tx-part">{whole}</span>}{ownerLink(t) && <span className="tx-part">jako kertomatta</span>}</>;
}

/** The payee's mark and name, the quiet tags and what the build's extensions mark; the bank's own text is the line under them. */
function Who({ t, explained }: { t: ListedRow } & Pick<StatementProps, "explained">) {
  const text = bankText(t);
  return (
    <span className="tx-who">
      <span className="tx-line">
        <PayeeMark name={t.merchant} person={isPerson(t)} />
        <span className="tx-name">{t.merchant}</span>
        <Tags t={t} explained={explained} />
        <ExtensionRowParts row={t} mark />
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
function Detail({ t, categories, pending, onCategory, onStatement, note, scope }: RowProps & { scope: Scope }) {
  const owner = ownerLink(t);
  const text = signed(shownCents(t));
  return (
    <div className="tx-detail">
      <div className="tx-detail-acts">
        <CategoryChip categories={categories} value={t.category} pending={pending} merchant={t.merchant} note={note} manual={t.categorySource === "user"} onPick={t.own ? (c) => onCategory(t.id, c) : undefined} />
        <a className="btn btn-small" href={`#/transactions?merchant=${encodeURIComponent(t.merchant)}`}>
          Kaikki: {t.merchant}
        </a>
        {cardBill(t) && t.own && onStatement && <button className="btn btn-small" type="button" aria-label={`Erittele ostot: ${t.merchant}`} onClick={() => onStatement(t)}>Erittele ostot</button>}
        {owner && <a className="btn btn-small" href={owner}>Kenen?</a>}
        {wholeOfRow(t) && shownCents(t) !== 0 && (
          <span>Osuutesi: <Why figure="share.part" title="Osuutesi" range={{ from: t.bookingDate, to: t.bookingDate }} scope="own" row={t.id} account={t.accountId} text={text}>{text}</Why></span>
        )}
      </div>
      <ExtensionRowParts row={t} />
      <MerchantDrill merchant={t.merchant} scope={scope} />
    </div>
  );
}

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
 * them. An opened row shows its payee's twelve months under it.
 */
export function TxTable({ items, today, daySums, rowProps, scope, open, onOpen }: { items: ListedRow[]; today: string; daySums: Map<string, DaySum>; rowProps: (t: ListedRow) => RowProps; scope: Scope; open: string | null; onOpen: (id: string | null) => void }) {
  const days = byDay(items);
  const maxOf = new Map(days.flatMap((d) => d.items.map((t) => [t.id, dayMax(d.items)] as const)));
  const columns: Column<ListedRow>[] = [
    { key: "who", label: "Saaja tai maksaja", kind: "text", rowHead: true, cell: (t) => <Who t={t} explained={rowProps(t).explained} /> },
    { key: "account", label: "Tili", kind: "text", className: () => "tx-account", headClass: "tx-account", cell: (t) => <AccountMark look={rowProps(t).look} fallback={rowProps(t).account} /> },
    { key: "category", label: "Kategoria", kind: "text", className: () => "tx-category", headClass: "tx-category", cell: (t) => <CategoryLabel categories={rowProps(t).categories} value={rowProps(t).pending ?? t.category} manual={t.categorySource === "user"} /> },
    {
      key: "amount",
      label: "Summa",
      kind: "money",
      main: true,
      cell: (t) => {
        const share = !t.isTransfer && maxOf.get(t.id) ? barShare(Math.abs(shownCents(t)), maxOf.get(t.id)!) : 0;
        return (
          <>
            <Amount t={t} />
            <Part t={t} />
            {share > 0 && (
              <span className={`tx-bar${t.amountCents > 0 ? " in" : ""}`} aria-hidden="true">
                <span style={{ inlineSize: `${(share * 100).toFixed(1)}%` }} />
              </span>
            )}
          </>
        );
      },
    },
  ];
  return (
    <Table<ListedRow>
      caption="Tapahtumat"
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
              <span className="rt-group-count">{plural(sum?.count ?? d.items.length, "tapahtuma", "tapahtumaa")}</span>
            </>
          ),
          figure: <DaySums sum={sum} />,
          figureSpan: 2,
          rows: d.items,
        };
      })}
      open={open}
      onOpen={onOpen}
      drill={(t) => <Detail {...rowProps(t)} scope={scope} />}
      drillLabel={(t) => `Avaa ${t.merchant}: 12 kuukautta`}
    />
  );
}

/** The table before the first answer: a day's row and four rows, grey bars where the payee and the figure will stand. */
export function RowsSkeleton() {
  return (
    <div className="tx-skel-rows" role="status" aria-live="polite">
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
