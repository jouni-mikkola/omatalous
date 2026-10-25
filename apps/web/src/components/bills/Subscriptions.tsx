/**
 * Decision: what we are subscribed to, what it costs a month, and which to drop.
 *
 * Tilaukset in the table kit (PD-laskut 2.3): the payee beside its mark, Kuussa with a bar on one scale for every row,
 * the charge with the last price move as a chip, and the next charge. The head's figure is the server's total of the
 * subscriptions (`subscriptionsMonthlyCents`) and opens its rows; the table adds nothing. A row opens in place: its price
 * steps, a year of it, its contract, and the one action "Merkitse lopetetuksi" with its undo. Whether a service is still
 * used is asked in Tarkistettavat, never here. A subscription marked as cancelled stands under its own group row, out of
 * the total, until its charges stop.
 */
import { type MarkKind, parseSeriesId, seriesOfMarkSubject, type UserMark } from "@banking/core";
import { useEffect, useState } from "react";
import { date, dayHeading, money, monthYear } from "../../format.ts";
import type { Recurring as Series, Scope } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { BarCell, DeltaChip, MarkCell } from "../table/Cells.tsx";
import { type Column, Table } from "../table/Table.tsx";
import { MerchantAvatar } from "../MerchantAvatar.tsx";
import { Why } from "../Why.tsx";
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

export function Subscriptions({
  subs,
  stopped,
  total,
  controls,
  label,
  cards,
  today,
  range,
  scope,
}: {
  subs: Series[];
  stopped: Series[];
  total: number;
  controls: MarkControls;
  label: (id: string) => string;
  /** The ids of the credit card accounts: a series charged to one is "Kortilla". */
  cards: ReadonlySet<string>;
  today: string;
  range: { from: string; to: string };
  scope: Scope;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!subs.length && !stopped.length) return null;
  const all = [...subs, ...stopped];
  // the bar's one scale: the largest row of the table is full width
  const max = Math.max(...all.map((s) => s.monthlyCents), 1);
  // a merchant with several subscriptions says each one's price in its name, so the household sees which one it answers
  const priced = (s: Series) => all.some((o) => o !== s && o.merchant === s.merchant);
  const nameOf = (s: Series) => (priced(s) ? `${s.merchant} ${money(s.typicalAmountCents)}` : s.merchant);
  const columns: Column<Series>[] = [
    {
      key: "merchant",
      label: "Saaja",
      kind: "text",
      rowHead: true,
      sort: (s) => s.merchant,
      cell: (s) => (
        <MarkCell name={s.merchant} mark={<MerchantAvatar name={s.merchant} person={false} size="m" />}>
          <span className="sub-merchant">{nameOf(s)}</span>
          <span className="sub-category">{label(s.category)}</span>
        </MarkCell>
      ),
    },
    {
      key: "monthly",
      label: "Kuussa",
      kind: "money",
      main: true,
      sort: (s) => s.monthlyCents,
      cell: (s) => money(s.monthlyCents),
      bar: { value: (s) => s.monthlyCents, max },
    },
    {
      key: "price",
      label: "Hinta",
      kind: "money",
      cell: (s) => {
        const last = s.priceSteps?.at(-1);
        return (
          <>
            <span className="sub-price">{money(s.typicalAmountCents)}</span>
            {last?.deltaCents !== undefined && (
              <span className="sub-chip" title={`${monthYear(last.date)} alkaen`}>
                <DeltaChip delta={last.deltaCents} text={money(Math.abs(last.deltaCents))} meaning="spend" />
              </span>
            )}
          </>
        );
      },
    },
    {
      key: "next",
      label: "Seuraava",
      kind: "date",
      sort: (s) => s.nextDate ?? "9999",
      cell: (s) => (
        <>
          {s.nextDate ? dayHeading(s.nextDate, today) : "–"}
          {cards.has(parseSeriesId(s.id)?.accountId ?? "") && <span className="mb-tag sub-card">Kortilla</span>}
        </>
      ),
    },
  ];
  return (
    <div className="card subs">
      <div className="card-head tb">
        <div className="card-name">
          <h2>Tilaukset</h2>
        </div>
        <div className="card-datum">
          <Why figure="bills.subs" title="Tilaukset kuussa" range={range} scope={scope} text={`${money(total, false)}/kk`}>
            <Figure text={`${money(total, false)}/kk`} size="s" />
          </Why>
        </div>
      </div>
      <Table<Series>
        caption="Tilaukset"
        className="sub-table"
        rows={all}
        rowKey={(s) => s.id}
        columns={columns}
        groups={[
          ...(subs.length > 0 ? [{ key: "subs", rows: subs }] : []),
          ...(stopped.length > 0 ? [{ key: "stopped", title: <>Merkitty lopetetuksi<span className="rt-group-count">{stopped.length}</span></>, rows: stopped }] : []),
        ]}
        rowClassName={(s) => (stopped.includes(s) ? "sub-stopped" : undefined)}
        open={open}
        onOpen={setOpen}
        drill={(s) => <Drill s={s} name={nameOf(s)} today={today} controls={controls} />}
        drillLabel={(s) => `Hinnat ja lopetus: ${nameOf(s)}`}
      />
    </div>
  );
}

/** The row opened: every price it had, a year of it, its contract, and the one action. */
function Drill({ s, name, today, controls }: { s: Series; name: string; today: string; controls: MarkControls }) {
  const c = s.contract;
  return (
    <div className="sub-drill">
      {priceMoved(s) ? (
        <div className="sub-steps">
          <StepLine name={s.merchant} steps={s.priceSteps!} today={today} />
          <MoveLine step={s.priceSteps!.at(-1)!} />
        </div>
      ) : (
        <p className="sub-line">{`Sama hinta ${monthYear(s.firstDate)} alkaen`}</p>
      )}
      <dl className="sub-facts">
        <div>
          <dt>Vuodessa</dt>
          <dd>{money(s.yearlyCents)}</dd>
        </div>
        {c && (
          <div>
            <dt>Sopimus alkoi</dt>
            <dd>{date(c.startDate)}</dd>
          </div>
        )}
        {c?.ended && (
          <div>
            <dt>Päättyi</dt>
            <dd>{date(c.endedOn ?? c.lastDate)}</dd>
          </div>
        )}
      </dl>
      <MarkAction s={s} name={name} controls={controls} />
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
        <span className="badge warn">Merkitty lopetetuksi</span>
        {onMerchant && <span className="muted small">Koskee kaikkia kauppiaan tilauksia.</span>}
        <button className="btn btn-small" type="button" disabled={controls.busy} aria-busy={waits} aria-label={`Kumoa: ${onMerchant ? s.merchant : name}`} onClick={() => {
            setPressed(true);
            controls.clear(mark);
          }}>
          Kumoa
        </button>
      </div>
    );
  }
  return (
    <div className="sub-actions">
      <button className="btn btn-small" type="button" disabled={controls.busy} aria-busy={waits} aria-label={`Merkitse lopetetuksi: ${name}`} onClick={() => {
          setPressed(true);
          controls.set(s, "cancelled");
        }}>
        Merkitse lopetetuksi
      </button>
    </div>
  );
}
