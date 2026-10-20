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
import { Fragment, useEffect, useState } from "react";
import { date, dayHeading, money, monthYear } from "../../format.ts";
import type { Recurring as Series, Scope } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { BarCell, DeltaChip, MarkCell, SortHead } from "../table/Cells.tsx";
import { DensitySwitch, DrillButton, RichTable, useDensity } from "../table/RichTable.tsx";
import { sortBy, useSort } from "../table/sort.ts";
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

type Key = "merchant" | "monthly" | "next";
const COLUMNS = 4;

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
  const [density, setDensity] = useDensity("subscriptions");
  const [sort, onSort] = useSort<Key>(["merchant"]);
  const [open, setOpen] = useState<string | null>(null);
  if (!subs.length && !stopped.length) return null;
  const all = [...subs, ...stopped];
  // the bar's one scale: the largest row of the table is full width
  const max = Math.max(...all.map((s) => s.monthlyCents), 1);
  // a merchant with several subscriptions says each one's price in its name, so the household sees which one it answers
  const priced = (s: Series) => all.some((o) => o !== s && o.merchant === s.merchant);
  const order = (rows: Series[]) => sortBy(rows, sort, (s, k) => (k === "merchant" ? s.merchant : k === "monthly" ? s.monthlyCents : (s.nextDate ?? "9999")));
  const row = (s: Series, muted: boolean) => {
    const isOpen = open === s.id;
    const last = s.priceSteps?.at(-1);
    const onCard = cards.has(parseSeriesId(s.id)?.accountId ?? "");
    const name = priced(s) ? `${s.merchant} ${money(s.typicalAmountCents)}` : s.merchant;
    return (
      <Fragment key={s.id}>
        <tr className={muted ? "sub-stopped" : undefined}>
          <td className="sub-name">
            <DrillButton open={isOpen} onToggle={() => setOpen(isOpen ? null : s.id)} label={`Hinnat ja lopetus: ${name}`} />
            <MarkCell name={s.merchant} mark={<MerchantAvatar name={s.merchant} person={false} size={density === "compact" ? "s" : "m"} />}>
              <span className="sub-merchant">{name}</span>
              <span className="sub-category">{label(s.category)}</span>
            </MarkCell>
          </td>
          <td className="num sub-monthly" data-rt="main">
            {money(s.monthlyCents)}
            <BarCell value={s.monthlyCents} max={max} />
          </td>
          <td className="num sub-price-cell">
            <span className="sub-price">{money(s.typicalAmountCents)}</span>
            {last?.deltaCents !== undefined && (
              <span className="sub-chip" title={`${monthYear(last.date)} alkaen`}>
                <DeltaChip delta={last.deltaCents} text={money(Math.abs(last.deltaCents))} meaning="spend" />
              </span>
            )}
          </td>
          <td data-label="Seuraava">
            {s.nextDate ? dayHeading(s.nextDate, today) : "–"}
            {onCard && <span className="mb-tag sub-card">Kortilla</span>}
          </td>
        </tr>
        {isOpen && (
          <tr className="rt-detail">
            <td colSpan={COLUMNS}>
              <Drill s={s} name={name} today={today} controls={controls} />
            </td>
          </tr>
        )}
      </Fragment>
    );
  };
  return (
    <div className="card subs">
      <div className="card-head tb">
        <div className="card-name">
          <h2>Tilaukset</h2>
        </div>
        <div className="card-tool">
          <DensitySwitch density={density} onChange={setDensity} />
        </div>
        <div className="card-datum">
          <Why figure="bills.subs" title="Tilaukset kuussa" range={range} scope={scope} text={`${money(total, false)}/kk`}>
            <Figure text={`${money(total, false)}/kk`} size="s" />
          </Why>
        </div>
      </div>
      <RichTable density={density} cards label="Tilaukset" className="sub-table">
        <thead>
          <tr>
            <Head label="Saaja" k="merchant" sort={sort} onSort={onSort} />
            <Head label="Kuussa" k="monthly" sort={sort} onSort={onSort} num />
            <th className="num" scope="col">
              Hinta
            </th>
            <Head label="Seuraava" k="next" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        {subs.length > 0 && <tbody>{order(subs).map((s) => row(s, false))}</tbody>}
        {stopped.length > 0 && (
          <tbody>
            <tr className="group-row">
              <td colSpan={COLUMNS}>
                Merkitty lopetetuksi
                <span className="rt-group-count">{stopped.length}</span>
              </td>
            </tr>
            {order(stopped).map((s) => row(s, true))}
          </tbody>
        )}
      </RichTable>
    </div>
  );
}

function Head({ label, k, sort, onSort, num }: { label: string; k: Key; sort: ReturnType<typeof useSort<Key>>[0]; onSort: (k: Key) => void; num?: boolean }) {
  return <SortHead label={label} dir={sort?.key === k ? sort.dir : null} numeric={num} onSort={() => onSort(k)} />;
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
