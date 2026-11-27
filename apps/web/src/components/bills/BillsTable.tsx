/**
 * Decision: which bill, contract or subscription to look at, to drop or to answer, and what each month leaves after the bills.
 *
 * Laskut' one table: the bill calendar of core, a group for each of the twelve months, in the table kit with no search,
 * chips or sorting. A row is a bill, a loan payment, a pay or a regular saving with its day and its amount. A row whose day and
 * amount are known says nothing more; any other carries a flag before its sum: the amount is an estimate (Summa arvioitu), it is
 * paid (Maksettu), a card pays it (Kortilla, in no sum), it did not come (Ei tullut) or has ended (Päättynyt). An open month's
 * rows end in its figures, all core's (`totalRows`): Maksettu (`paidCents`, Nyt, only while a charge is made), Maksamatta
 * (`billsCents`, Arvio) with its parts by kind (`essentialCents`, `debtCents`, `contractCents`, `optionalCents`), the saving,
 * the pays (`incomeCents`) and what is left after the bills (`afterCents`); the page adds up nothing. The head of a closed
 * month carries one figure, the bills still to pay (`billsCents`). The running month's name
 * is followed by *kesken*, every later month's by the Arvio chip. In a month that holds a bill whose sum is not known the sum of what is left is a
 * status with the count of those bills, and the other months keep their figure.
 * One month starts open: the running month while a bill of it is still to pay, otherwise the next one (`startOpenMonth`); the
 * reader opens any other. An open month
 * lists what is still to come; two rows or more of it that a card pays, and two paid rows or more, fold under a toggle each
 * that names their count.
 * This month and the next list every row; the later months list the bills that come less often than monthly one by one
 * and fold the monthly ones into one row that opens to them, with the number and sum core gives. A row opens in place:
 * how often it comes and its earlier payments with their sum (DrillRows), and the one action of a subscription,
 * "Merkitse lopetetuksi" with its undo (what has ended waits in a folded group of its own), or the removal of a bill typed
 * in. A bill the app found that is no recurring bill is removed the same way: the mark `wrongBillSubject` takes it out of
 * the list and of every sum of what is coming. Whether a service is still used is asked in Tarkistettavat.
 */
import { type MarkKind, parseSeriesId, seriesOfMarkSubject, type UserMark, unknownBillsIn } from "@banking/core";
import { type ReactNode, useEffect, useId, useState } from "react";
import { api } from "../../api.ts";
import { CADENCE_LABEL, dayMonth, date, money, monthLong, seriesName } from "../../format.ts";
import { t, tn } from "../../text.ts";
import type { Recurring as Series, Scope } from "../../types.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Estimate } from "../Estimate.tsx";
import { KindChip } from "../KindChip.tsx";
import { MerchantAvatar } from "../MerchantAvatar.tsx";
import { MarkCell } from "../table/Cells.tsx";
import { DrillRows } from "../table/DrillRows.tsx";
import { type Column, Table } from "../table/Table.tsx";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { cadenceLabel } from "./BillForm.tsx";
import { type CalBill, type Calendar, type CalGroup, type CalRow, calendarGroups, ENDED_GROUP, startOpenMonth } from "./calendar-rows.ts";
import { type Item, type TypedBill, wrongBillSubject } from "./items.ts";

/** What one subscription row can do next to the mark it already has. */
export interface MarkControls {
  /** The mark on this series that still counts today, or null: its own, or an old one on its merchant. */
  markOf: (s: Series) => UserMark | null;
  busy: boolean;
  /** Marks this one series. */
  set: (s: Series, mark: MarkKind) => void;
  /** Takes a mark away under the subject it was stored with: an old mark on a merchant goes for every series of it. */
  clear: (mark: UserMark) => void;
}

/** "kuukausittain", or "11 kertaa vuodessa" for a monthly fee with a summer break. */
function frequency(s: Series): string {
  if (!s.cadence) return "–";
  const perYear = Math.round(s.perMonth * 12);
  return s.cadence === "monthly" && perYear < 12 ? t("bills.times_year", { n: perYear }) : (CADENCE_LABEL[s.cadence] ?? "–");
}

const capital = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/**
 * What a row says before its sum, or null for a bill whose day and sum are known, which is most of them: it did not come, a
 * card pays it, it is paid, or its sum is an estimate, which wears the app's one mark of an estimate in the estimate's colour.
 */
function flag(r: CalRow): ReactNode {
  if (r.kind === "ended") return t("bills.kind_ended");
  if (r.kind !== "row") return null;
  if (r.missed) return t("bills.status_missed");
  if (r.bill.onCard) return t("bills.on_card");
  if (r.bill.state === "paid") return t("bills.status_paid");
  if (r.bill.state !== "estimate") return null;
  return (
    <span className="bill-coming">
      <Estimate mark="line">{t("bills.status_estimate")}</Estimate>
    </span>
  );
}

/** A closed month's head: its one figure, and the count of bills whose sum or day is not known, which the figure leaves out. */
function ClosedSums({ sum, unknown }: { sum: number; unknown: number }) {
  return (
    <span className="bill-sums">
      {t("bills.sum_coming", { sum: money(sum) })}
      {unknown > 0 && <span className="bill-total-note">{tn(unknown, "bills.unknown_one", "bills.unknown_many")}</span>}
    </span>
  );
}

/** The sum of a row as the table prints it: a pay with its sign, and the one sum that may be unknown, what a month leaves. */
function sum(r: CalRow): string {
  if (r.kind === "row") return r.bill.kind === "income" ? `+${money(r.bill.cents)}` : money(r.bill.cents);
  if (r.kind === "ended") return money(r.item.cents);
  return r.cents === null ? t("bills.after_unknown") : money(r.cents);
}

/** What the row is when it has no category of its own. */
function kindOf(bill: CalBill): string {
  if (bill.kind === "saving") return t("bills.kind_saving");
  if (bill.kind === "income") return t("home.fig_income");
  return bill.kind === "loan" ? t("bills.kind_loan") : "–";
}

export function BillsTable({
  calendar,
  items,
  controls,
  label,
  scope,
  focus = null,
  onRemoved,
}: {
  calendar: Calendar;
  items: Item[];
  controls: MarkControls;
  label: (id: string) => string;
  scope: Scope;
  /** The month picked on the chart above: it opens when it is picked. */
  focus?: string | null;
  /** A bill typed in or a found one was removed: the page reads its answers again. */
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  /** The groups the reader opened or closed; of the others only `startOpenMonth`'s month is open. */
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  /** A found bill asked about: the series and the name the question says. */
  const [wrong, setWrong] = useState<{ series: Series; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listed = items.flatMap((i) => (i.series ? [i.series.id] : []));
  const nameOf = (i: Item) => (i.series ? (seriesName(i.series.id, i.series.typicalAmountCents, listed) ?? i.name) : i.name);
  const startOpen = startOpenMonth(calendar, items);
  const isOpen = (key: string) => toggled.get(key) ?? key === startOpen;
  const toggle = (key: string) => setToggled((before) => new Map(before).set(key, !isOpen(key)));
  useEffect(() => {
    if (focus !== null) setToggled((before) => (before.get(focus) === true ? before : new Map(before).set(focus, true)));
  }, [focus]);
  const typed = items.flatMap((i) => (i.typed ? [i.typed] : []));
  const groups = calendarGroups(calendar, items, typed, isOpen);
  /** The id of a folded row, which its toggle's `aria-controls` names. */
  const idBase = useId();
  const foldedRowId = (key: string) => `${idBase}-${key}`;
  const foldedRows = new Set(groups.flatMap((g) => g.fold?.keys ?? []));

  const remove = async (id: string) => {
    setRemoving(null);
    setError(null);
    try {
      await api(`/api/expected-bills/${encodeURIComponent(id)}`, { method: "DELETE" });
      onRemoved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const markWrong = async ({ series }: { series: Series }) => {
    setWrong(null);
    setError(null);
    try {
      await api("/api/marks", { method: "PUT", body: { subject: wrongBillSubject(series), mark: "dismissed" } });
      setOpen(null);
      onRemoved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // a subscription just marked as stopped leaves the calendar and lands in the group of what has ended, opened, so its undo is in sight
  const marking: MarkControls = {
    ...controls,
    set: (s, mark) => {
      controls.set(s, mark);
      setToggled((before) => new Map(before).set(ENDED_GROUP, true));
      setOpen(s.id);
    },
  };

  const rowName = (r: CalRow): string =>
    r.kind === "fold" ? t("bills.monthly_fold", { count: r.count }) : r.kind === "ended" ? nameOf(r.item) : r.kind === "total" ? t(`bills.total_${r.total}`) : r.item ? nameOf(r.item) : r.bill.payee;
  const columns: Column<CalRow>[] = [
    {
      key: "day",
      label: t("table.day"),
      kind: "date",
      rowHead: true,
      cell: (r) =>
        r.kind === "row" ? (
          dayMonth(r.bill.date)
        ) : r.kind === "ended" ? (
          r.item.series ? date(r.item.series.lastDate) : "–"
        ) : r.kind === "total" ? (
          // a total has no day: its name and kind stand in the row header; a part of the bills still to come is of their kind and repeats no chip
          <span className="bill-total-name">
            {rowName(r)}
            {!r.part && <KindChip kind={r.figure} />}
            {!!r.unknown && <span className="bill-total-note">{tn(r.unknown, "bills.unknown_one", "bills.unknown_many")}</span>}
          </span>
        ) : (
          ""
        ),
    },
    {
      key: "payee",
      label: t("bills.payee"),
      kind: "text",
      headClass: "bill-payee",
      className: () => "bill-payee",
      cell: (r) =>
        r.kind === "fold" ? (
          <span className="bill-fold">{rowName(r)}</span>
        ) : r.kind === "total" ? (
          ""
        ) : (
          <MarkCell name={rowName(r)} mark={<MerchantAvatar name={rowName(r)} person={r.kind === "row" && r.bill.kind === "income"} size="m" />}>
            <span className="sub-merchant">{rowName(r)}</span>
          </MarkCell>
        ),
    },
    {
      key: "category",
      label: t("row.category_col"),
      kind: "text",
      headClass: "bill-category",
      className: () => "bill-category",
      cell: (r) => (r.kind === "fold" || r.kind === "total" ? "" : r.kind === "ended" ? (r.item.category ? label(r.item.category) : "–") : r.bill.category ? label(r.bill.category) : kindOf(r.bill)),
    },
    {
      key: "amount",
      label: t("bills.amount"),
      kind: "money",
      main: true,
      precision: "cents",
      cents: (r) => (r.kind === "row" ? r.bill.cents : r.kind === "fold" || r.kind === "total" ? r.cents : r.item.cents),
      className: (r) => (r.kind === "total" ? `bill-total-sum bill-total-${r.total} bill-total-${r.figure}` : ""),
      cell: (r) => {
        const says = flag(r);
        return says === null ? (
          sum(r)
        ) : (
          <>
            <span className="bill-flag">{says}</span>
            {sum(r)}
          </>
        );
      },
    },
  ];

  const head = (g: CalGroup) =>
    g.fold ? (
      // the count of the rows, and no sum: the month's head has the sum of the paid bills, and a card's rows are in no sum
      <button type="button" className="bill-subfold" aria-expanded={isOpen(g.key)} aria-controls={g.fold.keys.map(foldedRowId).join(" ")} onClick={() => toggle(g.key)}>
        <span aria-hidden="true">{isOpen(g.key) ? "▾" : "▸"}</span>
        {t(g.fold.kind === "card" ? "bills.card_fold" : "bills.paid_fold", { count: g.fold.keys.length })}
      </button>
    ) : (
      <button type="button" className="bill-month" aria-expanded={isOpen(g.key)} onClick={() => toggle(g.key)}>
        <span aria-hidden="true">{isOpen(g.key) ? "▾" : "▸"}</span>
        {g.month ? capital(monthLong(g.month.month)) : `${t("bills.ended")} ${g.ended}`}
        {g.month && (g.month.month === calendar.months[0]?.month ? <span className="bill-running">{t("home.months_running")}</span> : <KindChip kind="estimate" />)}
      </button>
    );
  const rowGroups = groups.map((g) => ({
    key: g.key,
    title: head(g),
    // a closed month tells one figure, its bills still to pay (the bills column of the front page reads it too); an open one tells them all in its closing rows
    figure: g.month && !g.fold && !isOpen(g.key) ? <ClosedSums sum={g.month.billsCents} unknown={unknownBillsIn(calendar, [g.month.month])} /> : undefined,
    figureSpan: columns.length - 2,
    rows: g.rows,
  }));
  const rows = groups.flatMap((g) => g.rows);

  return (
    <div className="card subs" id="laskut-taulukko">
      <div className="card-head tb">
        <div className="card-name">
          <h2>{t("bills.title")}</h2>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="bill-frame">
      <Table<CalRow>
        caption={t("bills.title")}
        className="sub-table bill-table"
        search={false}
        csv={false}
        rows={rows}
        rowKey={(r) => r.key}
        columns={columns}
        groups={rowGroups}
        rowClassName={(r) => (r.kind === "ended" || (r.kind === "row" && r.bill.state === "paid") ? "sub-stopped" : r.kind === "total" ? (r.part ? "bill-total bill-part" : "bill-total") : undefined)}
        rowProps={(r) => (foldedRows.has(r.key) ? { id: foldedRowId(r.key) } : {})}
        open={open}
        onOpen={setOpen}
        drill={(r) => (r.kind === "total" ? null : <Drill r={r} name={rowName(r)} controls={marking} scope={scope} onRemove={(b) => setRemoving({ id: b.id, name: b.name })} onWrong={(series) => setWrong({ series, name: rowName(r) })} />)}
        drillLabel={(r) => t("bills.details", { name: rowName(r) })}
      />
      </div>
      {removing && (
        <ConfirmDialog title={t("bills.remove_ask", { name: removing.name })} confirmLabel={t("bills.remove")} onConfirm={() => void remove(removing.id)} onCancel={() => setRemoving(null)} />
      )}
      {wrong && (
        <ConfirmDialog title={t("bills.remove_ask", { name: wrong.name })} confirmLabel={t("bills.remove")} onConfirm={() => void markWrong(wrong)} onCancel={() => setWrong(null)} />
      )}
    </div>
  );
}

/** How many earlier payments an opened row lists before the link to the whole list. */
const HISTORY_ROWS = 100;

/** The monthly bills one row of a later month stands for: the day, the payee and the sum of each. */
function Folded({ bills, name }: { bills: CalBill[]; name: string }) {
  const columns: Column<CalBill>[] = [
    { key: "day", label: t("table.day"), kind: "date", rowHead: true, cell: (b) => dayMonth(b.date) },
    { key: "payee", label: t("bills.payee"), kind: "text", cell: (b) => b.payee },
    { key: "amount", label: t("bills.amount"), kind: "money", main: true, precision: "cents", cents: (b) => b.cents },
  ];
  return <Table<CalBill> caption={name} rows={bills} rowKey={(b) => `${bills.indexOf(b)}`} columns={columns} toolbar={false} />;
}

/**
 * The row opened. A row of a series: how often it comes, a year of it, its last day, its history (the earlier payments
 * and their sum) and its action. The history is the payee's rows on the bill's account, which are the series' own only
 * when the payee has one product there: a series that is one product among several (`product` of its id) shows none. A
 * bill typed in: when it repeats and its next day, and its removal. Any other row (a pay, a loan payment, a saving) shows
 * the payments of its payee.
 */
function Drill({ r, name, controls, scope, onRemove, onWrong }: { r: Exclude<CalRow, { kind: "total" }>; name: string; controls: MarkControls; scope: Scope; onRemove: (b: TypedBill) => void; onWrong: (s: Series) => void }) {
  if (r.kind === "fold") return <Folded bills={r.bills} name={name} />;
  const i = r.item;
  const typed = r.kind === "row" ? r.typed : null;
  if (typed) {
    return (
      <div className="sub-drill">
        <dl className="sub-facts">
          <div>
            <dt>{t("bills.repeats")}</dt>
            <dd>{cadenceLabel(typed.cadence)}</dd>
          </div>
          <div>
            <dt>{typed.nextDate ? t("bills.next") : t("bills.due_was")}</dt>
            <dd>{date(typed.nextDate ?? typed.dueDate)}</dd>
          </div>
        </dl>
        <div className="sub-actions">
          <Button aria-label={t("bills.remove_named", { name: typed.name })} onClick={() => onRemove(typed)}>
            {t("bills.remove")}
          </Button>
        </div>
      </div>
    );
  }
  const s = i?.series;
  if (!i || !s) {
    // no series stands behind the row (a pay, a loan payment, a bill a card holds): the payments of its payee are its history
    const bill = r.kind === "row" ? r.bill : null;
    const id = bill?.seriesId ? parseSeriesId(bill.seriesId) : null;
    // a series that is one product among several of its payee shows no history: the payee's rows are not its own
    if (!bill || id?.product != null) return null;
    return (
      <div className="sub-drill">
        <DrillRows
          filter={{ merchant: id?.merchant ?? bill.payee, accountId: id?.accountId || undefined, scope }}
          name={name}
          limit={HISTORY_ROWS}
          payee={false}
          sign={bill.kind === "income" ? 1 : -1}
          sumLabel={t("bills.contract.total")}
        />
      </div>
    );
  }
  const id = parseSeriesId(s.id);
  // the payment of a saved loan is the loan's, which Varat ja velat keeps: no bill to take off the list
  const loanPays = r.kind === "row" && (r.bill.kind === "loan" || r.bill.loanSeries === true);
  return (
    <div className="sub-drill">
      <dl className="sub-facts">
        <div>
          <dt>{t("bills.frequency")}</dt>
          <dd>{frequency(s)}</dd>
        </div>
        <div>
          <dt>{t("bills.per_year")}</dt>
          <dd>{money(s.yearlyCents)}</dd>
        </div>
        <div>
          <dt>{t("bills.last")}</dt>
          <dd>{date(s.lastDate)}</dd>
        </div>
      </dl>
      {id && id.product === null && (
        <DrillRows
          filter={{ merchant: s.merchant, accountId: id.accountId || undefined, scope }}
          name={name}
          limit={HISTORY_ROWS}
          payee={false}
          sign={id.direction === "out" ? -1 : 1}
          sumLabel={t("bills.contract.total")}
        />
      )}
      {i.twins?.map((b) => (
        <div key={b.id} className="sub-actions">
          <Button aria-label={t("bills.remove_named", { name: b.name })} onClick={() => onRemove(b)}>
            {t("bills.remove_typed")}
          </Button>
        </div>
      ))}
      {/* a bill that did not come is ended by the mark Tarkistettavat's answer Lopetettu sets; one that was never a bill is still removed */}
      {(i.kind === "subscription" || i.stopped || i.missed) && <MarkAction s={s} name={name} controls={controls} />}
      {(i.kind === "bill" || i.kind === "contract") && !i.twins?.length && !loanPays && (
        // a bill or a contract the rows gave and the household says is none: out of the list and of the sums of what is coming
        <div className="sub-actions">
          <Button aria-label={t("bills.remove_named", { name })} onClick={() => onWrong(s)}>
            {t("bills.remove")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** "Merkitse lopetetuksi", or the mark and its undo while it stands. */
export function MarkAction({ s, name, controls }: { s: Series; name: string; controls: MarkControls }) {
  const mark = controls.markOf(s);
  // the button of this row that was pressed; only it shows the wait
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (!controls.busy) setPressed(false);
  }, [controls.busy]);
  const waits = (controls.busy && pressed) || undefined;
  if (mark?.mark === "cancelled") {
    // a mark from before marks named one subscription is on the merchant: it covers every row of it, and Kumoa takes it from all
    const onMerchant = seriesOfMarkSubject(mark.subject) === null;
    return (
      <div className="sub-actions">
        <span className="badge warn">{t("bills.stopped")}</span>
        {onMerchant && <span className="muted small">{t("bills.merchant_wide")}</span>}
        <Button
          disabled={controls.busy}
          aria-busy={waits}
          aria-label={t("bills.undo_named", { name: onMerchant ? s.merchant : name })}
          onClick={() => {
            setPressed(true);
            controls.clear(mark);
          }}
        >
          {t("bills.undo")}
        </Button>
      </div>
    );
  }
  return (
    <div className="sub-actions">
      <Button
        disabled={controls.busy}
        aria-busy={waits}
        aria-label={t("bills.mark_named", { name })}
        onClick={() => {
          setPressed(true);
          controls.set(s, "cancelled");
        }}
      >
        {t("bills.mark")}
      </Button>
    </div>
  );
}
