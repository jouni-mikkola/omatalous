/**
 * What the filtered rows add up to, above the list: money out and in and what they leave as labelled figures on one
 * line, the count and the days quiet beside them. Decision: is this filter's money what the household expected, and
 * when did it move. Every figure is a server field (`/api/transactions`); the web draws them and adds nothing up. The
 * histogram of the period waits behind its title at every width, so the list starts right under the figures. It shows
 * money out or in as the reader chooses, and a tap on a bar limits the period to that day, week or month.
 */
import { addDays } from "@banking/core";
import { type ReactNode, useState } from "react";
import { Figure } from "../../components/Figure.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { date, dateRange, dayHeading, money, monthLong } from "../../format.ts";
import { t, tn } from "../../text.ts";
import type { Period } from "./DateRange.tsx";
import { css } from "../../css.ts";

interface MoneyBin {
  start: string;
  count: number;
  outCount: number;
  inCount: number;
  inCents: number;
  outCents: number;
}

export interface Totals {
  total: number;
  /** Null while the server's figures are older than the rows: the strip then says it is updating instead of a sum. */
  inCents: number | null;
  outCents: number | null;
  netCents?: number | null;
  /** What the rows move onto savings or into savings categories, negative when taken out: Tulos is `netCents` less this. */
  savedCents?: number | null;
  /** Tulos of the rows (`totalsOf`): `netCents` less what moved to savings, with the credit the rows draw. */
  leftCents?: number | null;
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
  unit === "day" ? dayHeading(b.start, today) : unit === "week" ? t("tx.week", { range: dateRange(b.start, binEnd(b.start, unit)) }) : monthLong(b.start.slice(0, 7));

const unitTitle = (unit: "day" | "week" | "month"): string => t(`tx.unit_${unit}`);

/**
 * Where the peak's sum is tied to an edge of the plot instead of its bar: centred on a bar near an edge it would stick
 * out. The share is a rule of thumb for a sum of about 70 px over a plot of a phone's width.
 */
export function peakEdge(peak: number, bins: number): "start" | "end" | undefined {
  const at = (peak + 0.5) / bins;
  return at < 0.15 ? "start" : at > 0.85 ? "end" : undefined;
}

type Series = "out" | "in";

function Histogram({ unit, bins, today, last, income, onPick }: { unit: "day" | "week" | "month"; bins: MoneyBin[]; today: string; last: string; income: boolean; onPick: (p: Period) => void }) {
  const [at, setAt] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const value = (b: MoneyBin) => (income ? b.inCents : b.outCents);
  const max = Math.max(0, ...bins.map(value));
  const peak = bins.findIndex((b) => value(b) === max && max > 0);
  const n = bins.length;
  const edge = peakEdge(peak, n);
  const W = 100;
  const H = 40;
  const gap = n > 60 ? 0.15 : 0.3;
  const shown = at ?? peak;
  const b = shown >= 0 ? bins[shown] : undefined;
  // at rest the peak's sum above its bar says the picture; the line under it is of the bar the pointer or the keyboard is on
  const readout = b && (at !== null || focused) ? t(income ? "tx.readout_in" : "tx.readout_out", { bin: binName(b, unit, today), amount: money(value(b)), events: tn(income ? b.inCount : b.outCount, "tx.event_one", "tx.event_many") }) : "";
  const histTitle = t(income ? "tx.hist_in" : "tx.hist_out", { unit: unitTitle(unit) });
  return (
    <>
      <div className="tx-hist-plot">
        {peak >= 0 && (
          <span className="tx-hist-peak" data-edge={edge} ref={css({ left: edge ? undefined : `${((peak + 0.5) / n) * 100}%` })} aria-hidden="true">
            {money(max)}
          </span>
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t("tx.hist_aria", { title: histTitle, max: money(max) })}
          tabIndex={0}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAt(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))));
          }}
          onPointerLeave={() => setAt(null)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
    </>
  );
}

/** `income`: the limit is income only, so the histogram starts on money in. The period is the bar's chip; the sums are of what it and the other limits leave. `more`: what else waits behind the histogram's title, beside the picture. */
export function TotalsStrip({ totals, income, today, onPick, more }: { totals: Totals; income: boolean; today: string; onPick: (p: Period) => void; more?: ReactNode }) {
  const span = totals.span;
  const hist = totals.histogram;
  const [series, setSeries] = useState<Series>(income ? "in" : "out");
  const [seenIncome, setSeenIncome] = useState(income);
  if (seenIncome !== income) {
    setSeenIncome(income);
    setSeries(income ? "in" : "out");
  }
  const inSeries = series === "in";
  const histTitle = t(inSeries ? "tx.hist_in" : "tx.hist_out", { unit: hist ? unitTitle(hist.unit) : "" });
  // Käteen jäi says nearly what Erotus says, so it takes Erotus's place when it differs from it
  const shownResult = totals.leftCents !== undefined && totals.leftCents !== null && totals.leftCents !== totals.netCents;
  const picture = hist && hist.bins.length > 1 && (
    <figure className="tx-hist">
      <figcaption className="tx-hist-head">
        <span className="sr-only">{histTitle}</span>
        <Segmented<Series>
          label={t("tx.series")}
          value={series}
          options={[
            { value: "out", label: t("tx.spending") },
            { value: "in", label: t("tx.income") },
          ]}
          onChange={setSeries}
        />
      </figcaption>
      <Histogram key={series} unit={hist.unit} bins={hist.bins} income={inSeries} today={today} last={span?.to ?? today} onPick={onPick} />
    </figure>
  );
  return (
    <section className="tx-totals" aria-label={t("tx.totals_label")}>
      <div className="tx-sums">
        <p className="tx-totals-meta">
          <span className="tx-totals-count">{tn(totals.total, "tx.event_one", "tx.event_many")}</span>
          {span && <span className="tx-totals-span">{dateRange(span.from, span.to)}</span>}
          {(totals.inCents === null || totals.outCents === null) && <span className="tx-totals-span">{t("tx.updating")}</span>}
        </p>
        {totals.inCents !== null && totals.outCents !== null && (
        <dl className="tx-totals-kv">
          <div>
            <dt>{t("tx.spending")}</dt>
            <dd>
              <Figure text={money(-totals.outCents, false)} size="m" />
            </dd>
          </div>
          <div>
            <dt>{t("tx.income")}</dt>
            <dd className="tx-in">
              <Figure text={`${totals.inCents > 0 ? "+" : ""}${money(totals.inCents, false)}`} size="m" />
            </dd>
          </div>
          {totals.netCents !== undefined && totals.netCents !== null && !shownResult && (
            <div>
              <dt>{t("tx.difference")}</dt>
              <dd>
                <Figure text={`${totals.netCents > 0 ? "+" : ""}${money(totals.netCents, false)}`} size="m" />
              </dd>
            </div>
          )}
          {totals.savedCents !== undefined && totals.savedCents !== null && totals.savedCents !== 0 && (
            <div>
              <dt>{t(totals.savedCents > 0 ? "tx.saved" : "tx.savings_drawn")}</dt>
              <dd>
                <Figure text={money(Math.abs(totals.savedCents), false)} size="m" />
              </dd>
            </div>
          )}
          {shownResult && totals.leftCents != null && (
            <div>
              <dt>{t("tx.result")}</dt>
              <dd>
                <Figure text={`${totals.leftCents > 0 ? "+" : ""}${money(totals.leftCents, false)}`} size="m" />
              </dd>
            </div>
          )}
        </dl>
        )}
      </div>
      {/* the list is what the page is for: the picture waits behind its title until it is asked for */}
      {picture && (
        <details className="tx-hist-fold">
          <summary>{histTitle}</summary>
          <div className="tx-hist-body">
            {picture}
            {more}
          </div>
        </details>
      )}
    </section>
  );
}

/** The strip before the first answer: its own frame at its final size, grey bars where the figures, the count and the histogram's title will stand. */
export function StripSkeleton() {
  return (
    <section className="tx-totals tx-skel" aria-hidden="true">
      <div className="tx-sums">
        <span className="tx-skel-figs">
          {[0, 1, 2].map((i) => (
            <span key={i} className="sk-bar sk-fig" />
          ))}
        </span>
      </div>
      <span className="sk-bar sk-label" />
    </section>
  );
}
