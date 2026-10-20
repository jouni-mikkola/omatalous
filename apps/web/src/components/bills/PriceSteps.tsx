/**
 * Decision: which subscription's price moved, and whether it is still worth what it costs now.
 *
 * One small step chart per subscription whose price has changed, every price dated (the series' `priceSteps`, core
 * recurring; `priceChange` is only the last move). Each tile has its own scale, so the chart shows when and how the
 * price moved and the labels say how much; the axis does not start at zero, which is said in the panel's note. The line
 * under each tile is the last move and what it adds to a year, both the server's.
 */
import type { PriceStep } from "@banking/core";
import { money, monthYear, plural } from "../../format.ts";
import type { Recurring as Series } from "../../types.ts";
import { MerchantAvatar } from "../MerchantAvatar.tsx";

/** The subscriptions whose price moved: those with two prices or more. */
export const priceMoved = (s: Series): boolean => (s.priceSteps?.length ?? 0) > 1;

export function PriceSteps({ subs, today }: { subs: Series[]; today: string }) {
  const moved = subs.filter(priceMoved);
  if (!moved.length) return null;
  return (
    <section className="card ps span-12" aria-labelledby="ps-title">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="ps-title">Tilaukset, joiden hinta muuttui</h2>
        </div>
        <div className="card-datum">{plural(moved.length, "tilaus", "tilausta")}</div>
      </div>
      <ul className="ps-tiles">
        {moved.map((s) => (
          <li key={s.id} className="ps-tile">
            <div className="ps-head">
              <MerchantAvatar name={s.merchant} person={false} />
              <span className="ps-name">{s.merchant}</span>
            </div>
            <StepLine name={s.merchant} steps={s.priceSteps!} today={today} />
            <MoveLine step={s.priceSteps!.at(-1)!} />
          </li>
        ))}
      </ul>
      <p className="ps-note">Jokaisella tilauksella on oma asteikkonsa, joka ei ala nollasta.</p>
    </section>
  );
}

/** The last move in words: "Nousi 2,00 € 06/2026, 24,00 € enemmän vuodessa". Both figures are the step's own fields. */
export function MoveLine({ step }: { step: PriceStep }) {
  if (step.deltaCents === undefined) return null;
  const up = step.deltaCents > 0;
  const yearly = step.yearlyDeltaCents === undefined ? "" : `, ${money(Math.abs(step.yearlyDeltaCents))} ${up ? "enemmän" : "vähemmän"} vuodessa`;
  return <p className="ps-move">{`${up ? "Nousi" : "Laski"} ${money(Math.abs(step.deltaCents))} ${monthYear(step.date)}${yearly}`}</p>;
}

/**
 * The prices of one series as a step line from the first charge to today, the first price at the left end and the
 * price now at the right, the date of each step under it where it does not crowd the next. The list read aloud has them all.
 */
export function StepLine({ name, steps, today }: { name: string; steps: PriceStep[]; today: string }) {
  const W = 240;
  const H = 56;
  const t0 = Date.parse(steps[0]!.date);
  const t1 = Math.max(Date.parse(today), t0 + 1);
  const x = (iso: string) => ((Date.parse(iso) - t0) / (t1 - t0)) * W;
  const values = steps.map((p) => p.cents);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.25 || hi * 0.1 || 1;
  const y = (c: number) => H - 6 - ((c - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 12);
  let d = "";
  steps.forEach((p, i) => {
    d += i === 0 ? `M0,${y(p.cents).toFixed(1)}` : `H${x(p.date).toFixed(1)}V${y(p.cents).toFixed(1)}`;
  });
  d += `H${W}`;
  const last = steps.at(-1)!;
  // the newest step's date always shows; an older one only where it does not crowd the date after it
  const dated = steps.filter((p, i) => i === steps.length - 1 || x(steps[i + 1]!.date) - x(p.date) > W * 0.6);
  return (
    <>
      <div className="ps-plot" aria-hidden="true">
        <span className="ps-end ps-end-first">
          <span style={{ insetBlockStart: `${((y(steps[0]!.cents) / H) * 100).toFixed(1)}%` }}>{money(steps[0]!.cents)}</span>
        </span>
        <svg className="ps-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" focusable="false">
          <path d={d} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="ps-end ps-end-now">
          <span style={{ insetBlockStart: `${((y(last.cents) / H) * 100).toFixed(1)}%` }}>{money(last.cents)}</span>
        </span>
        <div className="ps-dates">
          {dated.map((p) => (
            <span key={p.date} style={{ insetInlineStart: `${((x(p.date) / W) * 100).toFixed(1)}%` }}>
              {monthYear(p.date)}
            </span>
          ))}
        </div>
      </div>
      <ol className="sr-only" aria-label={`${name}: hinnat`}>
        {steps.map((p) => (
          <li key={p.date}>
            {monthYear(p.date)} alkaen {money(p.cents)}
          </li>
        ))}
      </ol>
    </>
  );
}
