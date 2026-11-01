/**
 * Decision: which bill, contract or subscription to look at, to drop or to answer, and what it costs a month.
 *
 * Laskut' one table: every bill, contract, subscription, saving plan and every bill typed in, each once, in the table
 * kit with no search, chips or sorting: the rows come in the order of the next payment. What has ended waits in a folded
 * group of its own under it. One column holds the amount and, only when it differs, the month's share of it. A row opens in
 * place: its prices, its contract, and the one action of a subscription, "Merkitse lopetetuksi" with its undo, or the
 * removal of a bill typed in. The head's figure is core's fixed costs a month and opens its rows; the table adds nothing.
 * Whether a service is still used is asked in Tarkistettavat, never here.
 */
import { addMonthsToDate, type MarkKind, parseSeriesId, seriesOfMarkSubject, type UserMark } from "@banking/core";
import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import { CADENCE_LABEL, date, dayHeading, money, monthYear, seriesName } from "../../format.ts";
import { t } from "../../text.ts";
import type { Recurring as Series, Scope } from "../../types.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Figure } from "../Figure.tsx";
import { MerchantAvatar } from "../MerchantAvatar.tsx";
import { DeltaChip, MarkCell } from "../table/Cells.tsx";
import { type Column, Table } from "../table/Table.tsx";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Why } from "../Why.tsx";
import { ContractPanel } from "./ContractPanel.tsx";
import { cadenceLabel } from "./BillForm.tsx";
import { type Item, kindLabel, type TypedBill } from "./items.ts";
import { MoveLine, priceMoved, StepLine } from "./PriceSteps.tsx";

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

export function BillsTable({
  items,
  fixedCents,
  controls,
  label,
  cards,
  today,
  range,
  scope,
  onRemoved,
}: {
  items: Item[];
  /** Core's fixed costs a month. */
  fixedCents: number;
  controls: MarkControls;
  label: (id: string) => string;
  /** The ids of the credit card accounts: a series charged to one is "Kortilla". */
  cards: ReadonlySet<string>;
  today: string;
  range: { from: string; to: string };
  scope: Scope;
  /** A bill typed in was removed: the page reads its answers again. */
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [foldOpen, setFoldOpen] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!items.length) return null;
  const live = items.filter((i) => !i.ended);
  const ended = items.filter((i) => i.ended);
  const nameOf = (i: Item) => (i.series ? seriesName(i.series.id) ?? i.name : i.name);
  const onCard = (i: Item) => !!i.series && cards.has(parseSeriesId(i.series.id)?.accountId ?? "");

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

  const columns: Column<Item>[] = [
    {
      key: "name",
      label: t("bills.payee"),
      kind: "text",
      rowHead: true,
      cell: (i) => (
        <MarkCell name={i.name} mark={<MerchantAvatar name={i.name} person={false} size="m" />}>
          <span className="sub-merchant">{nameOf(i)}</span>
          <span className="sub-category">{i.category ? label(i.category) : kindLabel(i.kind)}</span>
        </MarkCell>
      ),
    },
    {
      key: "kind",
      label: t("bills.kind"),
      kind: "text",
      phone: "hide",
      cell: (i) => (i.stopped ? <span className="badge warn">{t("bills.stopped")}</span> : kindLabel(i.kind)),
    },
    {
      key: "next",
      label: t("bills.next"),
      kind: "date",
      className: () => "next-col",
      cell: (i) =>
        i.ended && i.series ? (
          t("bills.last_on", { date: date(i.series.lastDate) })
        ) : (
          <>
            {i.next ? dayHeading(i.next, today) : "–"}
            {i.series?.overdue && (
              <span className="badge warn" title={t("bills.expected_on", { date: date(i.series.nextDate) })}>
                {t("bills.late")}
              </span>
            )}
            {onCard(i) && <span className="mb-tag sub-card">{t("bills.on_card")}</span>}
          </>
        ),
    },
    {
      key: "price",
      label: t("bills.amount"),
      kind: "money",
      main: true,
      cents: (i) => i.cents,
      precision: "cents",
      cell: (i) => {
        const last = i.series?.priceSteps?.at(-1);
        // the month's share is news only when the charge is not a month's
        const share = !i.ended && i.monthlyCents !== null && i.monthlyCents !== i.cents ? i.monthlyCents : null;
        return (
          <>
            <span className="sub-price">{money(i.cents)}</span>
            {share !== null && <span className="sub-share">{t("bills.per_month_short", { amount: money(share) })}</span>}
            {last?.deltaCents !== undefined && (
              <span className="sub-chip" title={t("bills.since", { month: monthYear(last.date) })}>
                <DeltaChip delta={last.deltaCents} text={money(Math.abs(last.deltaCents))} meaning="spend" />
              </span>
            )}
          </>
        );
      },
    },
  ];
  const table = (caption: string, rows: Item[]) => (
    <Table<Item>
      caption={caption}
      className="sub-table"
      search={false}
      rows={rows}
      rowKey={(i) => i.key}
      columns={columns}
      rowClassName={(i) => (i.ended || i.stopped ? "sub-stopped" : undefined)}
      open={open}
      onOpen={setOpen}
      drill={(i) => <Drill i={i} name={nameOf(i)} today={today} controls={controls} onRemove={(b) => setRemoving({ id: b.id, name: b.name })} />}
      drillLabel={(i) => t("bills.details", { name: nameOf(i) })}
    />
  );
  return (
    <div className="card subs" id="laskut-taulukko">
      <div className="card-head tb">
        <div className="card-name">
          <h2>{t("bills.title")}</h2>
        </div>
        <div className="card-datum">
          <Why figure="bills.fixed" title={t("bills.fixed_title")} range={range} scope={scope} text={t("bills.per_month_short", { amount: money(fixedCents, false) })}>
            <Figure text={t("bills.per_month_short", { amount: money(fixedCents, false) })} size="s" />
          </Why>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {live.length > 0 && table(t("bills.title"), live)}
      {ended.length > 0 && (
        // a row the household just marked as stopped lands here with its detail open: the fold opens with it
        <details className="sub-ended" open={foldOpen || ended.some((i) => i.key === open)} onToggle={(e) => {
            const now = e.currentTarget.open;
            setFoldOpen(now);
            if (!now && ended.some((i) => i.key === open)) setOpen(null);
          }}
        >
          <summary>
            {t("bills.ended")} <b>{ended.length}</b>
          </summary>
          {table(t("bills.ended"), ended)}
        </details>
      )}
      {removing && (
        <ConfirmDialog title={t("bills.remove_ask", { name: removing.name })} confirmLabel={t("bills.remove")} onConfirm={() => void remove(removing.id)} onCancel={() => setRemoving(null)}>
          <p>{t("bills.remove_note")}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** The row opened: every price it had, a year of it, its contract, and the one action. */
function Drill({ i, name, today, controls, onRemove }: { i: Item; name: string; today: string; controls: MarkControls; onRemove: (b: TypedBill) => void }) {
  const s = i.series;
  if (i.typed) {
    const b = i.typed;
    return (
      <div className="sub-drill">
        <dl className="sub-facts">
          <div>
            <dt>{t("bills.repeats")}</dt>
            <dd>{cadenceLabel(b.cadence)}</dd>
          </div>
          <div>
            <dt>{b.nextDate ? t("bills.next") : t("bills.due_was")}</dt>
            <dd>{date(b.nextDate ?? b.dueDate)}</dd>
          </div>
        </dl>
        {!b.counted && <p className="sub-line">{t("bills.in_transactions")}</p>}
        <div className="sub-actions">
          <Button aria-label={t("bills.remove_named", { name: b.name })} onClick={() => onRemove(b)}>
            {t("bills.remove")}
          </Button>
        </div>
      </div>
    );
  }
  if (!s) return null;
  const c = s.contract;
  return (
    <div className="sub-drill">
      {priceMoved(s) ? (
        <div className="sub-steps">
          <StepLine name={s.merchant} steps={s.priceSteps!} today={today} />
          <MoveLine step={s.priceSteps!.at(-1)!} calculated={s.active && s.priceSteps!.at(-1)!.date >= addMonthsToDate(today, -12)} />
        </div>
      ) : (
        <p className="sub-line">{t("bills.same_price", { month: monthYear(s.firstDate) })}</p>
      )}
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
      {i.twins?.map((b) => (
        <div key={b.id} className="sub-actions">
          <span className="muted small">{t("bills.twin")}</span>
          <Button aria-label={t("bills.remove_named", { name: b.name })} onClick={() => onRemove(b)}>
            {t("bills.remove_typed")}
          </Button>
        </div>
      ))}
      {c && <ContractPanel contract={c} endedByUser={i.ended && !c.ended} />}
      {(i.kind === "subscription" || i.stopped) && <MarkAction s={s} name={name} controls={controls} />}
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
