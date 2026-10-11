import { type MarkKind, MIN_COMPARE_MONTHS } from "@banking/core";
import { type ReactNode, useState } from "react";
import { api, query } from "../api.ts";
import { PaceChart } from "../charts/PaceChart.tsx";
import { categoryColor } from "../charts/palette.ts";
import { Alerts } from "../components/Alerts.tsx";
import { DataScope } from "../components/DataScope.tsx";
import { Loading } from "../components/Loading.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { EmptyStart } from "../components/EmptyStart.tsx";
import { BarList } from "../components/BarList.tsx";
import { Insights } from "../components/Insights.tsx";
import { MonthlySpending } from "../components/MonthlySpending.tsx";
import { NextDays } from "../components/NextDays.tsx";
import { bridgeIncome } from "../components/month-parts.ts";
import { SurplusBridge } from "../components/SurplusBridge.tsx";
import { completeMonths, count, date, dayMonth, money, monthLong, monthSpan, percent, signedMoney } from "../format.ts";
import { navigate, useApi } from "../hooks.ts";
import type { DashboardData, Meta, Scope } from "../types.ts";
import "../styles/overview.css";

/** "+12 %", "−5 %" or "±0 %": the change from the earlier figure; null when there is nothing to compare with. */
function pctChange(current: number, previous: number): string | null {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  // U+2212 for a fall, the same minus as everywhere else in the app
  return pct === 0 ? "±0 %" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`;
}

/** "3 000–3 200 €", or one figure when the forecast has always been exact. */
function forecastRange(f: NonNullable<DashboardData["forecast"]>): string {
  if (f.lowCents === f.highCents) return money(f.highCents, false);
  return `${money(f.lowCents, false).replace(/\s€$/, "")}–${money(f.highCents, false)}`;
}

/** What the range stands on, so a household can tell a measured range from a typical one. */
function rangeBasis(f: NonNullable<DashboardData["forecast"]>): string {
  const pct = `vaihteluväli ±${count(f.rangePercent)} %`;
  return f.rangeBasis === "own"
    ? `${pct}, laskettu ennusteen osumista ${f.rangeMonths} edellisenä kuukautena`
    : `${pct}, yleinen virhemarginaali, oma historia puuttuu`;
}

const rangeDays = (r: { from: string; to: string }) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1;

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

  // alerts and insights the household has answered: gone at once, the reload below only confirms it
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const answer = (id: string, subject: string, mark: MarkKind) => {
    setMarking(true);
    setMarkError(null);
    api("/api/marks", { method: "PUT", body: { subject, mark } })
      .then(() => {
        setAnswered((prev) => new Set(prev).add(id));
        reload();
      })
      .catch((e: Error) => setMarkError(e.message))
      .finally(() => setMarking(false));
  };

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

  const { totals, previousTotals, trend, colorOrder, comparable, forecast } = data;
  // a running period is compared with the same days of the previous one
  // the year only when the comparison falls in another year (Tämä vuosi, or January)
  const prevYear = data.range.previousTo.slice(0, 4) === data.range.to.slice(0, 4) ? "" : data.range.previousTo.slice(0, 4);
  const vs = data.running ? `verrattuna ${dayRange(data.range.previousFrom, data.range.previousTo)}${prevYear}` : "edellisestä jaksosta";
  const goToCategory = (category: string) => navigate("transactions", { category, from: range.from, to: range.to });

  const restCents = data.categories.slice(9).reduce((s, c) => s + c.cents, 0);
  const barItems = [
    ...data.categories.slice(0, 9).map((c) => ({
      key: c.category,
      label: c.label,
      value: c.cents,
      valueText: money(c.cents, false),
      sub: comparable && c.previousCents ? signedMoney(c.cents - c.previousCents) : undefined,
      color: categoryColor(c.category, colorOrder),
    })),
    ...(restCents > 0
      ? [{ key: "rest", label: `Muut (${data.categories.length - 9})`, value: restCents, valueText: money(restCents, false), color: "var(--series-rest)", link: false }]
      : []),
  ];
  const expenseChange = comparable ? pctChange(totals.expenseCents, previousTotals.expenseCents) : null;
  const categoriesSub = [
    `Menot ${money(totals.expenseCents, false)}`,
    expenseChange ? `${expenseChange} ${vs}` : !comparable && data.dataFrom ? `ei vertailua, tiedot alkavat ${date(data.dataFrom)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const pace = data.pace;
  // "kertaa kuussa" over ten days or one month repeats the count
  const longRange = rangeDays(range) > 62;

  return (
    <div className={`stack ${loading ? "loading" : ""}`}>
      <DataScope meta={meta} scope={scope} signals={data.dataSignals} />

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

      <section className={`month-row${forecast ? " with-forecast" : ""}`} aria-label="Kuukauden menot">
        {forecast && <ForecastCard forecast={forecast} />}
        <MonthlySpending trend={trend} colorOrder={colorOrder} range={range} />
      </section>

      {data.ahead && (
        <div className="card">
          <NextDays ahead={data.ahead} />
        </div>
      )}

      <div className="card">
        <SurplusBridge totals={data.bridge.totals} title="Mihin tulot menivät" heading="h2" sub={bridgeSub(data.bridge, data.range.to.slice(0, 7))} />
        {data.fixedMonthlyCents > 0 && (
          <p className="bridge-fixed">
            Kiinteät menot <strong>{money(data.fixedMonthlyCents, false)}</strong> kuukaudessa · <a href="#/recurring">Toistuvat</a>
          </p>
        )}
      </div>

      <Alerts alerts={data.alerts.filter((a) => !answered.has(a.id))} range={range} onMark={answer} busy={marking || loading} />
      <Insights insights={data.insights.filter((i) => !answered.has(i.id)).slice(0, 3)} onDismiss={(id, subject) => answer(id, subject, "dismissed")} busy={marking || loading} />
      {markError && (
        <div className="error" role="alert">
          {markError}
        </div>
      )}

      <div className="grid two">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Kategoriat</h2>
              <div className="card-sub">{categoriesSub}</div>
            </div>
          </div>
          <BarList items={barItems} onSelect={goToCategory} />
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{forecast ? "Kuukauden kulku" : capitalize(monthLong(pace.month))}</h2>
              <div className="card-sub">
                {pace.currentTotal <= 0
                  ? "Ei vielä menoja tässä kuussa."
                  : pace.usualAtToday === null
                    ? `${money(pace.currentTotal, false)} nyt, vertailu näkyy ${completeMonths(MIN_COMPARE_MONTHS, true)} jälkeen`
                    : forecast
                      ? `${money(pace.currentTotal, false)} nyt, tavallisesti tähän mennessä ${money(pace.usualAtToday, false)}`
                      : `${money(pace.currentTotal, false)}, tavallisesti koko kuukaudessa ${money(pace.usualMonthTotal ?? 0, false)}`}
              </div>
            </div>
          </div>
          <PaceChart current={pace.current} usual={pace.usual} />
        </div>
      </div>

      <div className="card overview-merchants">
        <div className="card-head">
          <div>
            <h2>Kauppiaat</h2>
            <div className="card-sub">Ilman laskuja ja tilauksia</div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kauppias</th>
                <th className="num hide-phone">Kertaa</th>
                {longRange && <th className="num hide-phone">Kertaa kuussa</th>}
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
          {!data.merchants.length && <div className="empty">Ei ostoksia tällä jaksolla. Kauppiaat näkyvät, kun jaksolle tulee ostoksia.</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * What the split of income covers, and for one month whether income and saving are above or below the usual: the usual
 * is the median of the complete months before it, so it shows only when there are three.
 */
function bridgeSub(b: DashboardData["bridge"], runningMonth: string): ReactNode {
  const month = b.month ? capitalize(monthLong(b.month)) : null;
  // "last" shows the latest complete month while another one runs, so the clause names the running one
  const basis =
    b.basis === "last"
      ? `${month} (${monthLong(runningMonth).split(" ")[0]} on kesken)`
      : b.basis === "settled"
        ? `${month ? `${month}, ilman` : "Ilman"} kesken olevaa kuukautta`
        : b.basis === "running"
          ? "Kuukausi on kesken, palkka voi puuttua"
          : month;
  const { incomeCents: income, savingsRate } = b.totals;
  // the figure the change is told from: earned income, as the usual income is
  const named = bridgeIncome(b);
  const incomeChange = named.usualCents ? pctChange(named.cents, named.usualCents) : null;
  return (
    <>
      {basis && <div>{basis}</div>}
      {b.month && income > 0 && (
        <div>
          <a href="#/reports">{named.label}</a> {money(named.cents, false)}
          {incomeChange && `, ${incomeChange} tavallisesta`}
          {savingsRate !== null && `, säästöön ${percent(savingsRate)}${b.usualSavingsRate !== null ? ` (tavallisesti ${percent(b.usualSavingsRate)})` : ""}`}
        </div>
      )}
    </>
  );
}

/**
 * Where the running month is heading, with what the range stands on. The month the forecast is for is named, because
 * the period on the page can be longer.
 */
function ForecastCard({ forecast: f }: { forecast: NonNullable<DashboardData["forecast"]> }) {
  const change = f.usualMonthCents ? pctChange(f.forecastCents, f.usualMonthCents) : null;
  return (
    <div className="card forecast-card">
      <div className="card-head">
        <div>
          <h2>Ennuste kuun loppuun</h2>
          <div className="card-sub">{capitalize(monthLong(f.month))}</div>
        </div>
      </div>
      <div className="tile-value">{forecastRange(f)}</div>
      <div className="tile-note">{rangeBasis(f)}</div>
      <dl className="forecast-parts">
        <div>
          <dt>Menot tähän mennessä</dt>
          <dd>{money(f.spentCents, false)}</dd>
        </div>
        <div>
          <dt>Tulossa tässä kuussa</dt>
          <dd>{money(f.billsLeftCents, false)}</dd>
        </div>
        <div>
          <dt>
            Tavallisesti kuussa
            {f.usualMonthCents !== null && <small className="muted"> ({monthSpan(f.usualMonths)})</small>}
          </dt>
          <dd>{f.usualMonthCents === null ? "–" : money(f.usualMonthCents, false)}</dd>
        </div>
      </dl>
      <p className="small muted forecast-usual">{change ? `Ennuste on ${change} tavallisesta kuusta` : `Vertailu näkyy, kun historiassa on ${completeMonths(MIN_COMPARE_MONTHS)}`}</p>
    </div>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
