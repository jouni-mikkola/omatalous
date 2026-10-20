/**
 * What the filtered rows add up to, above the list: the count, money out and in and their difference, with a small
 * histogram of the period. Decision: is this filter's money what the household expected, and which days took it.
 * Every figure is a server field (`/api/transactions`); the web draws them and adds nothing up. A tap on a bar
 * narrows the list to that day, week or month.
 */
import { addDays } from "@banking/core";
import { type ReactNode, useState } from "react";
import { Figure } from "../../components/Figure.tsx";
import { date, dayHeading, money, monthLong, plural } from "../../format.ts";
import type { Period } from "./DateRange.tsx";

export interface MoneyBin {
  start: string;
  count: number;
  inCents: number;
  outCents: number;
}

export interface Totals {
  total: number;
  inCents: number;
  outCents: number;
  netCents?: number;
  span?: Period | null;
  histogram?: { unit: "day" | "week" | "month"; bins: MoneyBin[] } | null;
}

const binEnd = (start: string, unit: "day" | "week" | "month"): string => {
  if (unit === "day") return start;
  if (unit === "week") return addDays(start, 6);
  const [y, m] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  return addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`, -1);
};

const binName = (b: MoneyBin, unit: "day" | "week" | "month", today: string): string =>
  unit === "day" ? dayHeading(b.start, today) : unit === "week" ? `viikko ${date(b.start)}–${date(binEnd(b.start, unit))}` : monthLong(b.start.slice(0, 7));

const UNIT_TITLE = { day: "päivittäin", week: "viikoittain", month: "kuukausittain" } as const;

function Histogram({ unit, bins, income, today, last, tool, onPick }: { unit: "day" | "week" | "month"; bins: MoneyBin[]; income: boolean; today: string; last: string; tool?: ReactNode; onPick: (p: Period) => void }) {
  const [at, setAt] = useState<number | null>(null);
  const value = (b: MoneyBin) => (income ? b.inCents : b.outCents);
  const max = Math.max(0, ...bins.map(value));
  const peak = bins.findIndex((b) => value(b) === max && max > 0);
  const n = bins.length;
  const W = 100;
  const H = 40;
  const gap = n > 60 ? 0.15 : 0.3;
  const shown = at ?? peak;
  const b = shown >= 0 ? bins[shown] : undefined;
  const readout = b ? `${binName(b, unit, today)}: ${income ? "saatu" : "maksettu"} ${money(value(b))}, ${plural(b.count, "tapahtuma", "tapahtumaa")}` : "";
  return (
    <figure className="tx-hist">
      <div className="tx-hist-head">
        <figcaption className="tx-hist-title">
          {income ? "Tulot" : "Menot"} {UNIT_TITLE[unit]}
        </figcaption>
        {tool}
      </div>
      <div className="tx-hist-plot">
        {peak >= 0 && (
          <span className="tx-hist-peak" style={{ left: `${((peak + 0.5) / n) * 100}%` }} aria-hidden="true">
            {money(max)}
          </span>
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${income ? "Tulot" : "Menot"} ${UNIT_TITLE[unit]}, suurin ${money(max)}`}
          tabIndex={0}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAt(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))));
          }}
          onPointerLeave={() => setAt(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setAt(Math.min(n - 1, (at ?? peak) + 1));
            else if (e.key === "ArrowLeft") setAt(Math.max(0, (at ?? peak) - 1));
            else if (e.key === "Enter" && b) onPick({ from: b.start, to: binEnd(b.start, unit) });
          }}
          onClick={() => b && at !== null && onPick({ from: b.start, to: binEnd(b.start, unit) })}
        >
          <line className="tx-hist-base" x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} vectorEffect="non-scaling-stroke" />
          {bins.map((x, i) => {
            const h = max ? (value(x) / max) * (H - 4) : 0;
            const w = W / n;
            return (
              <g key={x.start}>
                {h > 0 && <rect className={`tx-hist-bar${i === shown ? " on" : ""}`} x={i * w + (w * gap) / 2} width={w * (1 - gap)} y={H - 1 - h} height={h} />}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="tx-hist-axis" aria-hidden="true">
        <span>{bins[0] ? date(bins[0].start) : ""}</span>
        <span>{date(last)}</span>
      </div>
      <p className="tx-hist-readout" aria-live="polite">
        {readout}
      </p>
    </figure>
  );
}

/** `whole`: no period is set, so the sums are of the whole history. */
export function TotalsStrip({ totals, income, merchant, whole, today, tool, onPick }: { totals: Totals; income: boolean; merchant: string; whole: boolean; today: string; tool?: ReactNode; onPick: (p: Period) => void }) {
  const span = totals.span;
  const spanText = `${whole ? "Koko historia" : ""}${whole && span ? ", " : ""}${span ? `${date(span.from)}–${date(span.to)}` : ""}`;
  const hist = totals.histogram;
  return (
    <section className="tx-totals" aria-label="Rajattujen tapahtumien summat">
      <div className="tx-totals-figs">
        <div className="tx-totals-lead">
          <span className="tx-totals-count">{plural(totals.total, "tapahtuma", "tapahtumaa")}</span>
          <span className="tx-totals-span">
            {merchant ? `${merchant}, ` : ""}
            {spanText}
          </span>
        </div>
        <dl className="tx-totals-kv">
          <div>
            <dt>Maksettu</dt>
            <dd>
              <Figure text={money(-totals.outCents)} size="m" />
            </dd>
          </div>
          <div>
            <dt>Saatu</dt>
            <dd className="tx-in">
              <Figure text={`${totals.inCents > 0 ? "+" : ""}${money(totals.inCents)}`} size="m" />
            </dd>
          </div>
          {totals.netCents !== undefined && (
            <div>
              <dt>Ero</dt>
              <dd>
                <Figure text={`${totals.netCents > 0 ? "+" : ""}${money(totals.netCents)}`} size="m" />
              </dd>
            </div>
          )}
        </dl>
        <p className="tx-totals-note">Siirrot omien tilien välillä eivät ole mukana.</p>
      </div>
      {hist && hist.bins.length > 1 && <Histogram unit={hist.unit} bins={hist.bins} income={income} today={today} last={span?.to ?? today} tool={tool} onPick={onPick} />}
    </section>
  );
}

/** The strip before the first answer: its own frame at its final size, grey bars where the count, the figures and the bars will stand. */
export function StripSkeleton() {
  return (
    <section className="tx-totals tx-skel" aria-hidden="true">
      <div className="tx-totals-figs">
        <span className="sk-bar sk-label" />
        <span className="tx-skel-figs">
          {[0, 1, 2].map((i) => (
            <span key={i} className="sk-bar sk-fig" />
          ))}
        </span>
        <span className="sk-bar sk-sub" />
      </div>
      <div className="tx-hist">
        <span className="sk-bar sk-label" />
        <span className="sk-bar tx-skel-plot" />
      </div>
    </section>
  );
}
