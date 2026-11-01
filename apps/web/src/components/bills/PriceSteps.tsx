/** The step lines of a subscription whose price moved: the drill of Laskut' table shows them. */
import type { PriceStep } from "@banking/core";
import { money, monthYear } from "../../format.ts";
import { t } from "../../text.ts";
import { PRICE_RISES_HASH } from "../../routes.ts";
import type { Recurring as Series } from "../../types.ts";
import { css } from "../../css.ts";

/** The subscriptions whose price moved: those with two prices or more. */
export const priceMoved = (s: Series): boolean => (s.priceSteps?.length ?? 0) > 1;

/** The last move in words: "Nousi 2,00 € 06/2026, 24,00 € enemmän vuodessa". Both figures are the step's own fields. `calculated`: Kiinteät menot lists the rise, so the line links to its calculation. */
export function MoveLine({ step, calculated }: { step: PriceStep; calculated: boolean }) {
  if (step.deltaCents === undefined) return null;
  const up = step.deltaCents > 0;
  const params = { amount: money(Math.abs(step.deltaCents)), month: monthYear(step.date), yearly: step.yearlyDeltaCents === undefined ? "" : money(Math.abs(step.yearlyDeltaCents)) };
  const code = step.yearlyDeltaCents === undefined ? (up ? "bills.step_up" : "bills.step_down") : up ? "bills.step_up_year" : "bills.step_down_year";
  return (
    <p className="ps-move">
      {t(code, params)} {up && calculated && <a href={PRICE_RISES_HASH}>{t("bills.step_calc")}</a>}
    </p>
  );
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
          <span ref={css({ "inset-block-start": `${((y(steps[0]!.cents) / H) * 100).toFixed(1)}%` })}>{money(steps[0]!.cents)}</span>
        </span>
        <svg className="ps-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" focusable="false">
          <path d={d} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="ps-end ps-end-now">
          <span ref={css({ "inset-block-start": `${((y(last.cents) / H) * 100).toFixed(1)}%` })}>{money(last.cents)}</span>
        </span>
        <div className="ps-dates">
          {dated.map((p) => (
            <span key={p.date} ref={css({ "inset-inline-start": `${((x(p.date) / W) * 100).toFixed(1)}%` })}>
              {monthYear(p.date)}
            </span>
          ))}
        </div>
      </div>
      <ol className="sr-only" aria-label={t("bills.prices", { name })}>
        {steps.map((p) => (
          <li key={p.date}>
            {t("bills.price_from", { month: monthYear(p.date), price: money(p.cents) })}
          </li>
        ))}
      </ol>
    </>
  );
}
