import { useState } from "react";
import { query } from "../api.ts";
import { CalendarHeatmap } from "../charts/CalendarHeatmap.tsx";
import { PaceChart } from "../charts/PaceChart.tsx";
import { categoryColor } from "../charts/palette.ts";
import { Alerts } from "../components/Alerts.tsx";
import { Loading } from "../components/Loading.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { EmptyStart } from "../components/EmptyStart.tsx";
import { BarList } from "../components/BarList.tsx";
import { Insights } from "../components/Insights.tsx";
import { MonthlySpending } from "../components/MonthlySpending.tsx";
import { type Delta, StatTile } from "../components/StatTile.tsx";
import { count, date, dayMonth, money, monthLabel, monthLong, percent } from "../format.ts";
import { navigate, useApi } from "../hooks.ts";
import type { DashboardData, Meta, Scope } from "../types.ts";
import "../styles/overview.css";

function pctDelta(current: number, previous: number, upIsGood: boolean, vs = "edellisestä jaksosta"): Delta | undefined {
  if (!previous) return undefined;
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (pct === 0) return { text: "±0 %", tone: "neutral", suffix: vs };
  const up = pct > 0;
  return {
    text: `${up ? "+" : ""}${pct} %`,
    tone: up ? (upIsGood ? "up-good" : "up-bad") : upIsGood ? "down-bad" : "down-good",
    suffix: vs,
  };
}

const rangeDays = (r: { from: string; to: string }) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1;

/**
 * The savings rate of the period. A period that runs to today (Tämä vuosi)
 * counts its whole months only: the running month has its bills but often
 * not its salary yet, which would pull the rate down by several points.
 */
function savingsRateOf(data: DashboardData, range: { from: string; to: string }): { value: number | null; partial: boolean; label: string } {
  const whole = { value: data.totals.savingsRate, partial: false, label: "" };
  if (!data.running) return whole;
  const { trend } = data;
  const months = trend.months.map((_, i) => i).filter((i) => trend.complete[i] && trend.months[i]! >= range.from.slice(0, 7) && trend.months[i]! <= range.to.slice(0, 7));
  if (!months.length) return whole;
  const income = months.reduce((s, i) => s + trend.income[i]!, 0);
  const expenses = months.reduce((s, i) => s + trend.expenses[i]!, 0);
  const first = monthLabel(trend.months[months[0]!]!);
  const last = monthLabel(trend.months[months[months.length - 1]!]!);
  return { value: income > 0 ? (income - expenses) / income : null, partial: true, label: first === last ? first : `${first}–${last}` };
}

/** "2026-09-01", "2026-09-09" → "1.–9.9."; across months "28.8.–9.9." */
function dayRange(from: string, to: string): string {
  const a = dayMonth(from);
  const b = dayMonth(to);
  if (from === to) return b;
  return from.slice(0, 7) === to.slice(0, 7) ? `${a.split(".")[0]}.–${b}` : `${a}–${b}`;
}

export function Overview({
  meta,
  range,
  scope,
  onEmptyAction,
  onShowHousehold,
}: {
  meta: Meta;
  range: { from: string; to: string };
  scope: Scope;
  onEmptyAction: () => Promise<void>;
  onShowHousehold: () => void;
}) {
  const hasData = meta.accounts.length > 0 || (scope === "household" && meta.sharedAccounts.length > 0);
  // no request while there are no accounts: the first one after demo data or a sync is a fresh fetch
  const { data, error, loading, reload } = useApi<DashboardData>(hasData ? `/api/dashboard${query({ ...range, scope })}` : null);

  // a member who only sees accounts shared with them has nothing under "Oma"
  if (!hasData && meta.sharedAccounts.length > 0) {
    return (
      <div className="card" style={{ maxWidth: 640 }}>
        <h2>Ei omia tilejä</h2>
        <p className="muted">Sinulle jaetut tilit näkyvät kohdassa Koko talous.</p>
        <button className="btn btn-primary" type="button" onClick={onShowHousehold}>
          Näytä koko talous
        </button>
      </div>
    );
  }
  if (!hasData) return <EmptyStart onDemo={onEmptyAction} />;
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const { totals, previousTotals, trend, colorOrder, comparable } = data;
  // a running period is compared with the same days of the previous one
  // the year only when the comparison falls in another year (Tämä vuosi, or January)
  const prevYear = data.range.previousTo.slice(0, 4) === data.range.to.slice(0, 4) ? "" : data.range.previousTo.slice(0, 4);
  const vs = data.running ? `vs. ${dayRange(data.range.previousFrom, data.range.previousTo)}${prevYear}` : "edellisestä jaksosta";
  // the running month and the first, partly fetched one are not points on the sparklines
  const full = <T,>(values: T[]) => values.filter((_, i) => trend.complete[i]);
  const savingsSpark = trend.income.map((inc, i) => (inc > 0 ? Math.max(-1, (inc - trend.expenses[i]!) / inc) : 0));
  const forecast = data.forecast;
  // the running month alone: bills have gone out but the salary may not have come, so a savings
  // rate says nothing yet; where the month is heading does
  const monthSoFar = data.running && range.from.slice(0, 7) === range.to.slice(0, 7) && forecast !== null;
  const rate = savingsRateOf(data, range);
  const savingsDelta: Delta | undefined =
    !rate.partial && comparable && totals.savingsRate !== null && previousTotals.savingsRate !== null
      ? (() => {
          const pts = Math.round((totals.savingsRate - previousTotals.savingsRate) * 100);
          return { text: `${pts > 0 ? "+" : pts < 0 ? "−" : "±"}${Math.abs(pts)} %-yks.`, tone: pts > 0 ? "up-good" : pts < 0 ? "down-bad" : "neutral", suffix: vs };
        })()
      : undefined;
  const noComparison = !comparable && data.dataFrom ? `Ei vertailua, tiedot alkavat ${date(data.dataFrom)}` : undefined;
  const goToCategory = (category: string) => navigate("transactions", { category, from: range.from, to: range.to });

  const restCents = data.categories.slice(9).reduce((s, c) => s + c.cents, 0);
  const barItems = [
    ...data.categories.slice(0, 9).map((c) => ({
      key: c.category,
      label: c.label,
      value: c.cents,
      valueText: money(c.cents, false),
      sub: comparable && c.previousCents ? `${c.cents >= c.previousCents ? "+" : "−"}${money(Math.abs(c.cents - c.previousCents), false)}` : undefined,
      color: categoryColor(c.category, colorOrder),
    })),
    ...(restCents > 0
      ? [{ key: "rest", label: `Muut (${data.categories.length - 9})`, value: restCents, valueText: money(restCents, false), color: "var(--series-rest)", link: false }]
      : []),
  ];

  const pace = data.pace;
  // days before the first transaction are missing data, not days without spending
  const days = data.dataFrom ? data.daily.filter((d) => d.date >= data.dataFrom!) : data.daily;
  // "kertaa kuussa" over ten days or one month repeats the count
  const longRange = rangeDays(range) > 62;

  return (
    <div className={`stack ${loading ? "loading" : ""}`}>
      <div className="grid kpis">
        <StatTile
          label={monthSoFar ? "Menot tähän mennessä" : "Menot"}
          value={money(totals.expenseCents, false)}
          delta={comparable ? pctDelta(totals.expenseCents, previousTotals.expenseCents, false, vs) : undefined}
          foot={noComparison}
          note={totals.debtCents ? `josta velanhoito ${money(totals.debtCents, false)}` : undefined}
          spark={full(trend.expenses)}
        />
        {monthSoFar && forecast ? (
          <StatTile
            label="Ennuste kuun loppuun"
            value={money(forecast.forecastCents, false)}
            delta={forecast.averageMonthCents ? pctDelta(forecast.forecastCents, forecast.averageMonthCents, false, "tavallisesta kuusta") : undefined}
            foot={forecast.averageMonthCents ? undefined : "Ei vielä täysiä kuukausia vertailuun"}
            note={`laskuja vielä tässä kuussa ${money(forecast.billsLeftCents, false)}`}
          />
        ) : (
          <StatTile
            label="Säästöaste"
            value={rate.value === null ? "–" : percent(rate.value)}
            delta={savingsDelta}
            foot={rate.value === null ? "Ei lasketa ilman tuloja" : rate.partial ? `${rate.label}, ilman kesken olevaa kuuta` : undefined}
            note={[
              totals.savedCents ? `säästöön ${money(totals.savedCents, false)}` : undefined,
              !rate.partial && totals.netCents < 0 ? `menot ylittivät tulot ${money(-totals.netCents, false)}` : undefined,
            ]}
            spark={full(savingsSpark)}
          />
        )}
        <StatTile
          label="Tulot"
          value={money(totals.incomeCents, false)}
          delta={comparable && totals.incomeCents !== 0 ? pctDelta(totals.incomeCents, previousTotals.incomeCents, true, vs) : undefined}
          foot={totals.incomeCents === 0 ? (data.running ? "Ei vielä tuloja tällä jaksolla" : "Ei tuloja tällä jaksolla") : undefined}
          spark={full(trend.income)}
        />
        <StatTile label="Kiinteät menot" value={`${money(data.fixedMonthlyCents, false)}/kk`} note={`${money(data.fixedMonthlyCents * 12, false)} vuodessa`} />
      </div>

      {data.dataNotice && (
        <ul className="alerts" aria-label="Tietojen laatu">
          <li className="alert warning">
            <a href="#/reports">
              <span className="sr-only">Huomio: </span>
              <span className="alert-title">{data.dataNotice.title}</span>
              <span className="alert-detail">{data.dataNotice.detail}</span>
            </a>
          </li>
        </ul>
      )}
      <Alerts alerts={data.alerts} range={range} />
      <Insights insights={data.insights} />

      <div className="grid two">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Kategoriat</h2>
              {comparable && <div className="card-sub">Muutos {data.running ? vs : "edelliseen jaksoon"}</div>}
            </div>
          </div>
          <BarList items={barItems} onSelect={goToCategory} />
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{forecast ? "Kuukauden kulku" : capitalize(monthLong(pace.month))}</h2>
              <div className="card-sub">
                {pace.currentTotal > 0
                  ? forecast
                    ? `${money(pace.currentTotal, false)} nyt, tavallisesti tähän mennessä ${money(pace.averageAtToday, false)}`
                    : `${money(pace.currentTotal, false)}, kolmen edellisen kuun keskiarvo ${money(pace.averageMonthTotal, false)}`
                  : "Ei vielä menoja tässä kuussa."}
              </div>
            </div>
          </div>
          <PaceChart current={pace.current} average={pace.average} />
          {forecast && <Upcoming items={forecast.upcoming} />}
        </div>
      </div>

      <MonthlySpending trend={trend} colorOrder={colorOrder} range={range} />

      <div className="grid two">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Kauppiaat</h2>
              <div className="card-sub">Arjen ostokset, ilman laskuja ja tilauksia</div>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kauppias</th>
                  <th className="num hide-phone">Kertaa</th>
                  {longRange && <th className="num hide-phone">Krt/kk</th>}
                  <th className="num hide-phone">Keskiostos</th>
                  <th className="num">Yhteensä</th>
                </tr>
              </thead>
              <tbody>
                {data.merchants.slice(0, 12).map((m) => (
                  <tr key={m.merchant}>
                    <td>
                      <a href={`#/transactions?merchant=${encodeURIComponent(m.merchant)}&from=${range.from}&to=${range.to}`}>{m.merchant}</a>
                      <div className="sub">
                        {meta.categories.find((c) => c.id === m.category)?.label ?? m.category} · viimeksi {date(m.lastDate)}
                      </div>
                    </td>
                    <td className="num hide-phone">{m.count}</td>
                    {longRange && <td className="num hide-phone">{count(m.perMonth)}</td>}
                    <td className="num hide-phone">{money(m.avgCents)}</td>
                    <td className="num">
                      <strong>{money(m.totalCents, false)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.merchants.length && <div className="empty">Ei arjen ostoksia tällä jaksolla.</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Arjen kulutus päivittäin</h2>
              <div className="card-sub">Ilman laskuja ja tilauksia</div>
            </div>
          </div>
          <CalendarHeatmap days={days} />
          <WeekdaySummary days={days} />
        </div>
      </div>
    </div>
  );
}

const UPCOMING_SHOWN = 6;

/** Subscriptions and bills due in the next two weeks, the first few with the rest behind a button. */
function Upcoming({ items }: { items: NonNullable<DashboardData["forecast"]>["upcoming"] }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, UPCOMING_SHOWN);
  return (
    <>
      <h3 className="subhead upcoming-head">
        Tulossa 14 päivän aikana <span className="muted">· yhteensä {money(items.reduce((sum, u) => sum + u.amountCents, 0))}</span>
      </h3>
      <table className="compact">
        <tbody>
          {shown.map((u, i) => (
            <tr key={`${u.merchant}-${u.date}-${i}`}>
              <td>
                <a href={`#/transactions${query({ merchant: u.merchant })}`}>{u.merchant}</a>
              </td>
              <td className="num muted">{dayMonth(u.date)}</td>
              <td className="num">{money(u.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > UPCOMING_SHOWN && (
        <button className="btn btn-small upcoming-more" type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Näytä vähemmän" : `Näytä kaikki (${items.length})`}
        </button>
      )}
    </>
  );
}

const WEEKDAYS = ["maanantaisin", "tiistaisin", "keskiviikkoisin", "torstaisin", "perjantaisin", "lauantaisin", "sunnuntaisin"];
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One sentence: the most expensive weekday and how many days had no spending. */
function WeekdaySummary({ days }: { days: DashboardData["daily"] }) {
  if (!days.length) return null;
  const totals = new Array(7).fill(0) as number[];
  const counts = new Array(7).fill(0) as number[];
  for (const d of days) {
    const wd = (new Date(`${d.date}T00:00:00Z`).getUTCDay() + 6) % 7;
    totals[wd]! += d.cents;
    counts[wd]! += 1;
  }
  const avg = totals.map((t, i) => (counts[i] ? t / counts[i]! : 0));
  const top = avg.indexOf(Math.max(...avg));
  const noSpend = days.filter((d) => d.cents <= 0).length;
  return (
    <p className="small muted" style={{ marginBottom: 0 }}>
      Eniten kuluu {WEEKDAYS[top]}, keskimäärin {money(avg[top]!, false)}. Päiviä ilman kulutusta {noSpend}/{days.length}.
    </p>
  );
}
