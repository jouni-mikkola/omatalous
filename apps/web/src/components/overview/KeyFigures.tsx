import type { DashboardData, Scope } from "../../types.ts";
import { dayMonth, money, percent } from "../../format.ts";
import { Figure } from "../Figure.tsx";
import { Why } from "../Why.tsx";
import { paceRange } from "./Pace.tsx";

/**
 * The strip at the top of Yhteenveto: four answers a household opens the page for, each a figure the server sent and a
 * line that gives it a scale. The web adds up and compares no money here; a tile whose field is missing is not drawn.
 */
export function KeyFigures({ data, scope }: { data: DashboardData; scope: Scope }) {
  const { ahead, pace, previousMonthTotals, holdings } = data;
  const last = previousMonthTotals?.totals ?? null;
  const free = ahead?.balance ? ahead.balance.freeCents : null;
  return (
    <section className="key-figures" aria-label="Tilannekuva">
      {free !== null && ahead && (
        <div className="kf">
          <div className="kf-label">Käytettävissä</div>
          <Why figure="ahead.free" title="Käytettävissä" range={{ from: ahead.from, to: ahead.to }} scope={scope} text={money(free)}>
            <Figure text={money(free)} size="l" />
          </Why>
          <DayStrip from={ahead.from} days={ahead.days} bills={ahead.upcoming.map((r) => r.date)} />
          <div className="kf-sub">{dayMonth(ahead.to)} asti, laskut vähennetty</div>
        </div>
      )}
      <div className="kf">
        <div className="kf-label">Menot tässä kuussa</div>
        {/* the month's rows to today open from the figure, as the pace panel's head does */}
        <Why figure="spend.month" title="Menot tässä kuussa" range={paceRange(pace)} scope={scope} text={money(pace.currentTotal)}>
          <Figure text={money(pace.currentTotal)} size="l" />
        </Why>
        <Spark current={pace.current} previous={pace.usual?.curve ?? pace.previous?.curve ?? null} />
        {pace.usual ? <div className="kf-sub">Tavallisesti tähän päivään {money(pace.usual.toToday)}</div> : pace.previous && <div className="kf-sub">Edellinen kuu samaan päivään {money(pace.previous.toToday)}</div>}
      </div>
      {/* a month that is still running has its bills ahead of it, so what was left is told of every day of the month before */}
      {last && (
        <div className="kf">
          <div className="kf-label">Tulos viime kuussa</div>
          <Figure text={money(last.leftCents)} size="l" />
          {/* the ring is the rate's shape; its reading is the text beside it */}
          {last.savingsRate !== null && (
            <div className="kf-sub kf-rate">
              <Ring share={last.savingsRate} />
              Säästöaste {percent(last.savingsRate)}
            </div>
          )}
        </div>
      )}
      {holdings.accountsCents !== null && (
        <div className="kf">
          <div className="kf-label">Tilien saldo, ilman korttia</div>
          {/* today's balances: the day the window starts, else the end of the page's range */}
          <Why figure="holdings.accounts" title="Tilien saldo, ilman korttia" range={{ from: ahead?.from ?? data.range.to, to: ahead?.from ?? data.range.to }} scope={scope} text={money(holdings.accountsCents)}>
            <Figure text={money(holdings.accountsCents)} size="l" />
          </Why>
          {holdings.cardsCents !== null && <div className="kf-sub">Luottoa käytetty {money(holdings.cardsCents)}</div>}
        </div>
      )}
    </section>
  );
}

/** The month's spending curve against the usual month (or the month before without one), to the same scale: a shape, so no axis and no number of its own. */
function Spark({ current, previous }: { current: (number | null)[]; previous: number[] | null }) {
  const w = 160;
  const h = 32;
  const days = Math.max(current.length, previous?.length ?? 0);
  const top = Math.max(1, ...current.map((v) => v ?? 0), ...(previous ?? []));
  const x = (i: number) => (days <= 1 ? 0 : (i / (days - 1)) * w);
  const y = (v: number) => h - 2 - (v / top) * (h - 4);
  const path = (vs: (number | null)[]) => vs.flatMap((v, i) => (v === null ? [] : [`${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`])).join("");
  const last = current.reduce<number>((at, v, i) => (v === null ? at : i), -1);
  return (
    <svg className="kf-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      {previous && <path d={path(previous)} className="kf-spark-prev" />}
      <path d={path(current)} className="kf-spark-now" />
      {last >= 0 && <circle cx={x(last)} cy={y(current[last] ?? 0)} r={3} className="kf-spark-dot" />}
    </svg>
  );
}

/** The days to the end of the window as a strip of cells, today first; a day with a bill carries a dot. */
function DayStrip({ from, days, bills }: { from: string; days: number; bills: string[] }) {
  const at = (i: number) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
  const due = new Set(bills);
  return (
    <div className="kf-days" aria-hidden="true">
      {Array.from({ length: days + 1 }, (_, i) => (
        <span key={i} className={`kf-day${i === 0 ? " kf-today" : ""}${due.has(at(i)) ? " kf-due" : ""}`} />
      ))}
    </div>
  );
}

/** The savings rate as the share of a ring: a shape before its reading, clamped to the ring. */
function Ring({ share }: { share: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, share)) * c;
  return (
    <svg className="kf-ring" viewBox="0 0 36 36" width={16} height={16} aria-hidden="true">
      <circle cx={18} cy={18} r={r} className="kf-ring-track" />
      <circle cx={18} cy={18} r={r} className="kf-ring-fill" strokeDasharray={`${filled.toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 18 18)" />
    </svg>
  );
}
