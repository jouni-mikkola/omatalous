/**
 * Reports page: one section per report in @banking/core's registry. Each
 * section is its own component, so adding a report means adding one here.
 * The order goes from the whole picture to the details: money in and out,
 * where it went, month by month, what is locked in, what changed.
 */
import { useState } from "react";
import { daysInMonth } from "@banking/core";
import { query } from "../api.ts";
import { DivergingColumns } from "../charts/DivergingColumns.tsx";
import { LineChart } from "../charts/LineChart.tsx";
import { StackedColumns } from "../charts/StackedColumns.tsx";
import { date, money, monthLabel, monthLong, MONTHS_SHORT, percent, signedMoney } from "../format.ts";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { useApi } from "../hooks.ts";
import type { Meta, ReportsData, Scope } from "../types.ts";

type R = ReportsData;
type Range = { from: string; to: string };

export function Reports({ meta, range, scope }: { meta: Meta; range: Range; scope: Scope }) {
  const q = query({ ...range, scope });
  const { data, error, loading, reload } = useApi<R>(`/api/reports${q}`);
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  if (!data) return <div className="empty">Ladataan…</div>;
  const label = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;
  // the month that has not ended yet, marked in the tables
  const running = range.to >= meta.today ? meta.today.slice(0, 7) : null;
  const sections: [string, string][] = [
    ...(data.dataQuality.signals.length ? ([["laatu", "Tietojen laatu"]] as [string, string][]) : []),
    ["kassavirta", "Tulot ja menot"],
    ["kategoriat", "Kategoriat"],
    ["kuukaudet", "Kuukausitaulukko"],
    ["kiinteat", "Kiinteät ja muuttuvat"],
    ["hinnat", "Hinnanmuutokset"],
    ["vuodet", "Vuosivertailu"],
    ["ostot", "Suurimmat ostot"],
    ...(data.balances.accounts.length ? ([["saldot", "Saldot"]] as [string, string][]) : []),
  ];

  return (
    <div className={`stack ${loading ? "loading" : ""}`}>
      <nav className="report-nav" aria-label="Raportin osiot">
        {sections.map(([id, title]) => (
          <a
            key={id}
            href="#/reports"
            onClick={(e) => {
              // the hash is used by the router, so scroll instead of navigating
              e.preventDefault();
              document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            {title}
          </a>
        ))}
      </nav>
      <DataQuality r={data.dataQuality} range={range} />
      <Cashflow r={data.cashflow} running={running} exportHref={`/api/export/report.csv${query({ ...range, scope, report: "cashflow" })}`} />
      <Categories r={data.categories} range={range} exportHref={`/api/export/report.csv${query({ ...range, scope, report: "categories" })}`} />
      <Pivot r={data.pivot} partialLast={range.to < `${range.to.slice(0, 7)}-${daysInMonth(range.to.slice(0, 7))}`} exportHref={`/api/export/report.csv${query({ ...range, scope, report: "pivot" })}`} />
      <FixedVariable r={data.fixedVariable} />
      <PriceChanges r={data.priceChanges} label={label} isDebt={(id) => meta.categories.find((c) => c.id === id)?.kind === "debt"} />
      <YearOverYear r={data.yearOverYear} summary={data.summary} />
      <Purchases r={data.highlights} label={label} />
      {data.balances.accounts.length > 0 && <Balances r={data.balances} />}
    </div>
  );
}

function DataQuality({ r, range }: { r: R["dataQuality"]; range: Range }) {
  if (!r.signals.length) return null;
  return (
    <Section id="laatu" title="Tietojen laatu" sub="Näissä kohdissa luvut voivat poiketa todellisesta.">
      <ul className="plain">
        {r.signals.map((s) => (
          <li key={s.id} style={{ margin: "0 0 10px" }}>
            <strong>{s.title}</strong>
            <div className="muted">
              {s.detail}
              {s.category && (
                <>
                  {" "}
                  <a href={`#/transactions${query({ category: s.category, from: range.from, to: range.to })}`}>Näytä tapahtumat</a>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Section({ id, title, sub, actions, children }: { id: string; title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card" id={id}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        {actions && <div className="form-row" style={{ margin: 0 }}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function ExportLink({ href }: { href: string }) {
  return (
    <a className="btn btn-small" href={href} download>
      Lataa CSV
    </a>
  );
}

function TableToggle({ table, onToggle }: { table: boolean; onToggle: () => void }) {
  return (
    <button className="btn btn-small" onClick={onToggle} aria-pressed={table}>
      {table ? "Kaavio" : "Taulukko"}
    </button>
  );
}

function Kv({ items }: { items: [string, string][] }) {
  return (
    <div className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="k">{k}</div>
          <div className="v">{v}</div>
        </div>
      ))}
    </div>
  );
}

// ── money in and out ──────────────────────────────────────
function Cashflow({ r, running, exportHref }: { r: R["cashflow"]; running: string | null; exportHref: string }) {
  const [table, setTable] = useState(false);
  const t = r.totals;
  const monthLabelOf = (m: string) => `${monthLong(m)}${m === running ? " (kesken)" : ""}`;
  return (
    <Section
      id="kassavirta"
      title="Tulot ja menot"
      sub={r.average ? `Kuukaudessa keskimäärin tulot ${money(r.average.incomeCents, false)}, menot ${money(r.average.consumptionCents + r.average.debtCents, false)}` : undefined}
      actions={
        <>
          <TableToggle table={table} onToggle={() => setTable((v) => !v)} />
          <ExportLink href={exportHref} />
        </>
      }
    >
      <Kv
        items={[
          ["Tulot", money(t.incomeCents, false)],
          ["Menot", money(t.expenseCents, false)],
          ["Säästöön", money(t.savedCents, false)],
          [t.netCents < 0 ? "Menot ylittivät tulot" : "Tuloja jäi yli", money(Math.abs(t.netCents), false)],
          ["Säästöaste", t.savingsRate === null ? "–" : percent(t.savingsRate)],
          ...(t.borrowedCents ? ([["Luotonnostot", money(t.borrowedCents, false)]] as [string, string][]) : []),
        ]}
      />
      {table ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kuukausi</th>
                <th className="num">Tulot</th>
                <th className="num">Kulutus</th>
                <th className="num">Velanhoito</th>
                <th className="num">Säästöön</th>
                {t.borrowedCents !== 0 && <th className="num">Luotonnostot</th>}
                <th className="num">Erotus</th>
                <th className="num">Säästöaste</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.month}>
                  <td>{monthLabelOf(x.month)}</td>
                  <td className="num">{money(x.incomeCents, false)}</td>
                  <td className="num">{money(x.consumptionCents, false)}</td>
                  <td className="num">{money(x.debtCents, false)}</td>
                  <td className="num">{money(x.savedCents, false)}</td>
                  {t.borrowedCents !== 0 && <td className="num">{money(x.borrowedCents, false)}</td>}
                  <td className="num">
                    <strong>{money(x.netCents, false)}</strong>
                  </td>
                  <td className="num">{x.savingsRate === null ? "–" : percent(x.savingsRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <DivergingColumns
          months={r.rows.map((x) => x.month)}
          up={{ key: "income", label: "Tulot", color: "var(--series-1)", values: r.rows.map((x) => x.incomeCents) }}
          down={[
            { key: "consumption", label: "Kulutus", color: "var(--series-2)", values: r.rows.map((x) => x.consumptionCents) },
            { key: "debt", label: "Velanhoito", color: "var(--series-7)", values: r.rows.map((x) => x.debtCents) },
            { key: "saved", label: "Säästöön", color: "var(--series-3)", values: r.rows.map((x) => Math.max(0, x.savedCents)) },
          ]}
        />
      )}
    </Section>
  );
}

// ── categories ────────────────────────────────────────────
function Change({ now, before }: { now: number; before: number }) {
  if (!before && !now) return <span className="muted">–</span>;
  const diff = now - before;
  return <span className={Math.abs(diff) < 100 ? "muted" : diff > 0 ? "worse" : "better"}>{signedMoney(diff)}</span>;
}

/**
 * Where the money went: total, share and a usual month per category. The
 * monthly spread, counts and the three-month trend are in the CSV; on the
 * page they made ten columns that a household reads past.
 */
function Categories({ r, range, exportHref }: { r: R["categories"]; range: Range; exportHref: string }) {
  return (
    <Section id="kategoriat" title="Kategoriat" sub={r.comparable ? "Muutos edelliseen jaksoon" : undefined} actions={<ExportLink href={exportHref} />}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Kategoria</th>
              <th className="num">Yhteensä</th>
              <th className="num">Osuus</th>
              <th className="num hide-phone">Kuukaudessa</th>
              {r.comparable && <th className="num">Muutos</th>}
            </tr>
          </thead>
          <tbody>
            {r.groups.map((g) => [
              <tr key={g.group} className="group-row">
                <td>{g.group}</td>
                <td className="num">{money(g.totalCents, false)}</td>
                <td className="num">{percent(g.share)}</td>
                <td className="num hide-phone">{money(g.categories.reduce((s, c) => s + c.monthlyAvgCents, 0), false)}</td>
                {r.comparable && (
                  <td className="num">
                    <Change now={g.totalCents} before={g.previousCents} />
                  </td>
                )}
              </tr>,
              ...g.categories.map((c) => (
                <tr key={c.category}>
                  <td style={{ paddingLeft: 20 }}>
                    <a href={`#/transactions${query({ category: c.category, from: range.from, to: range.to })}`}>{c.label}</a>
                  </td>
                  <td className="num">{money(c.totalCents, false)}</td>
                  <td className="num">{percent(c.share)}</td>
                  <td className="num hide-phone">{money(c.monthlyAvgCents, false)}</td>
                  {r.comparable && (
                    <td className="num">
                      <Change now={c.totalCents} before={c.previousCents} />
                    </td>
                  )}
                </tr>
              )),
            ])}
          </tbody>
        </table>
        {!r.groups.length && <div className="empty">Ei menoja valitulla jaksolla.</div>}
      </div>
    </Section>
  );
}

// ── category × month table ────────────────────────────────
/**
 * Shade by where a month sits between the row's own lowest and highest month,
 * so a steady bill stays plain and a category that swings shows its peaks.
 */
function heatLevel(value: number, min: number, max: number): number {
  if (value <= 0 || max <= min * 1.15) return 0;
  const f = Math.max(0, (value - min) / (max - min));
  return f > 0.8 ? 4 : f > 0.55 ? 3 : f > 0.3 ? 2 : 1;
}

function Pivot({ r, partialLast, exportHref }: { r: R["pivot"]; partialLast: boolean; exportHref: string }) {
  return (
    <Section id="kuukaudet" title="Kuukausitaulukko" sub="Tummempi solu on kategorian kalleimpia kuukausia" actions={<ExportLink href={exportHref} />}>
      <div className="table-wrap">
        <table className="heat-table">
          <thead>
            <tr>
              <th>Kategoria</th>
              {r.months.map((m) => (
                <th key={m} className="num">
                  {monthLabel(m, m.endsWith("-01") || m === r.months[0])}
                </th>
              ))}
              <th className="num">Yhteensä</th>
              <th className="num">Ka/kk</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => {
              // the running month is low only because it is not over yet, and a month without
              // spending is a blank cell: neither sets the low end of the row
              const full = (partialLast && row.values.length > 1 ? row.values.slice(0, -1) : row.values).filter((v) => v > 0);
              const max = full.length ? Math.max(...full) : 0;
              const min = full.length ? Math.min(...full) : 0;
              return (
                <tr key={row.category}>
                  <td style={{ whiteSpace: "nowrap" }}>{row.label}</td>
                  {row.values.map((v, i) => (
                    <td key={i} className={`num cell heat-l${heatLevel(v, min, max)}`} title={`${row.label}, ${monthLong(r.months[i]!)}: ${money(v)}`}>
                      {v ? money(v, false) : ""}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{money(row.totalCents, false)}</strong>
                  </td>
                  <td className="num">{money(row.averageCents, false)}</td>
                </tr>
              );
            })}
            <tr className="group-row">
              <td>Yhteensä</td>
              {r.monthTotals.map((v, i) => (
                <td key={i} className="num">
                  {money(v, false)}
                </td>
              ))}
              <td className="num">{money(r.totalCents, false)}</td>
              <td className="num">{money(r.averageCents, false)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── fixed vs variable ─────────────────────────────────────
function FixedVariable({ r }: { r: R["fixedVariable"] }) {
  const t = r.totals;
  const consumption = t.fixedCents + t.habitCents + t.variableCents;
  const share = (v: number) => (consumption ? percent(v / consumption) : "–");
  return (
    <Section id="kiinteat" title="Kiinteät ja muuttuvat" sub="Kiinteät ovat tilauksia ja laskuja, arkiostot toistuvia pieniä ostoja, satunnaiset kaikkea muuta">
      <Kv
        items={[
          ["Kiinteät", `${money(t.fixedCents, false)} · ${share(t.fixedCents)}`],
          ["Arkiostot", `${money(t.habitCents, false)} · ${share(t.habitCents)}`],
          ["Satunnaiset", `${money(t.variableCents, false)} · ${share(t.variableCents)}`],
          ["Velanhoito", money(t.debtCents, false)],
        ]}
      />
      <StackedColumns
        months={r.rows.map((x) => x.month)}
        series={[
          { key: "fixed", label: "Kiinteät", color: "var(--series-1)", values: r.rows.map((x) => x.fixedCents) },
          { key: "habit", label: "Arkiostot", color: "var(--series-2)", values: r.rows.map((x) => x.habitCents) },
          { key: "variable", label: "Satunnaiset", color: "var(--series-3)", values: r.rows.map((x) => x.variableCents) },
          { key: "debt", label: "Velanhoito", color: "var(--series-7)", values: r.rows.map((x) => x.debtCents) },
        ]}
        height={240}
        label="Kiinteät ja muuttuvat menot"
      />
    </Section>
  );
}

// ── price changes ─────────────────────────────────────────
/** Prices and loan instalments apart: a smaller instalment after a rate cut is not a cheaper price. */
function PriceChanges({ r, label, isDebt }: { r: R["priceChanges"]; label: (id: string) => string; isDebt: (id: string) => boolean }) {
  const parts = [
    r.items.some((p) => !isDebt(p.category)) ? `Hinnat yhteensä ${signedMoney(r.totalYearlyEffectCents)} vuodessa` : null,
    r.items.some((p) => isDebt(p.category)) ? `lainojen erät ${signedMoney(r.debtYearlyEffectCents)} vuodessa` : null,
  ].filter((s): s is string => s !== null);
  const sub = parts.length ? parts.join(", ") : undefined;
  return (
    <Section id="hinnat" title="Hinnanmuutokset" sub={sub ? `${sub.charAt(0).toUpperCase()}${sub.slice(1)}` : undefined}>
      {r.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kauppias</th>
                <th className="num">Ennen → nyt</th>
                <th className="num">Vuodessa</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((p) => (
                <tr key={`${p.merchant}-${p.date}`}>
                  <td>
                    <a href={`#/transactions${query({ merchant: p.merchant })}`}>{p.merchant}</a>
                    <div className="sub">
                      {label(p.category)} · {date(p.date)}
                    </div>
                  </td>
                  <td className="num">
                    {money(p.fromCents)} → {money(p.toCents)}
                  </td>
                  <td className={`num ${p.yearlyEffectCents > 0 ? "worse" : "better"}`}>
                    <strong>{signedMoney(p.yearlyEffectCents)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">Ei hinnanmuutoksia viimeisen vuoden aikana.</div>
      )}
    </Section>
  );
}

// ── year over year ────────────────────────────────────────
function YearOverYear({ r, summary }: { r: R["yearOverYear"]; summary: R["summary"] }) {
  const diff = r.previousYtdCents ? (r.ytdCents - r.previousYtdCents) / r.previousYtdCents : null;
  const from = r.comparableFromMonth;
  const lastMonth = r.current.filter((v) => v !== null).length;
  // "Menot 2026 tähän asti", or the months both years have: "Menot elo–syys 2026"
  const span = from && from > 1 ? `${MONTHS_SHORT[from - 1]}–${MONTHS_SHORT[lastMonth - 1]} ` : "";
  const changes = summary.comparable ? summary.changes : [];
  return (
    <Section id="vuodet" title="Vuosivertailu" sub={from === null ? "Edellisen vuoden tietoja ei ole." : from > 1 ? `Molemmilta vuosilta on tiedot ${MONTHS_SHORT[from - 1]}kuusta alkaen.` : undefined}>
      <Kv
        items={[
          [`Menot ${span}${r.year}${span ? "" : " tähän asti"}`, money(r.ytdCents, false)],
          ...(from !== null
            ? ([
                [`Samaan aikaan ${r.year - 1}`, money(r.previousYtdCents, false)],
                ["Muutos", diff === null ? "–" : Math.round(diff * 100) === 0 ? "±0 %" : `${diff > 0 ? "+" : "−"}${Math.abs(Math.round(diff * 100))} %`],
              ] as [string, string][])
            : []),
          [`Tulot ${span}${r.year}${span ? "" : " tähän asti"}`, money(r.incomeYtdCents, false)],
        ]}
      />
      <LineChart
        labels={MONTHS_SHORT}
        series={[
          { key: "prev", label: String(r.year - 1), color: "var(--series-avg)", values: r.previous },
          // the running month is not over: the line ends at the last complete one
          { key: "cur", label: String(r.year), color: "var(--series-1)", values: r.partialMonth === null ? r.current : r.current.map((v, i) => (i + 1 >= r.partialMonth! ? null : v)) },
        ]}
      />
      {changes.length > 0 && (
        <>
          <h3 className="subhead">Suurimmat muutokset vuotta aiemmasta samasta jaksosta</h3>
          <table className="compact">
            <tbody>
              {changes.map((c) => (
                <tr key={c.category}>
                  <td>{c.label}</td>
                  <td className="num muted">
                    {money(c.previousCents, false)} → {money(c.cents, false)}
                  </td>
                  <td className={`num ${c.cents > c.previousCents ? "worse" : "better"}`}>{signedMoney(c.cents - c.previousCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}

// ── balances ──────────────────────────────────────────────
function Balances({ r }: { r: R["balances"] }) {
  const colors = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-5)", "var(--series-6)", "var(--series-7)"];
  return (
    <Section id="saldot" title="Saldot" sub="Kuukauden lopussa">
      <LineChart
        labels={r.months.map((m) => monthLabel(m, m.endsWith("-01")))}
        series={r.accounts.slice(0, 6).map((a, i) => ({ key: a.accountId, label: a.name, color: colors[i]!, values: a.values }))}
      />
    </Section>
  );
}

// ── largest purchases ─────────────────────────────────────
const LARGEST_SHOWN = 10;
const NEW_SHOWN = 8;

/** One-off purchases worth remembering, and places the household started using in the period. */
function Purchases({ r, label }: { r: R["highlights"]; label: (id: string) => string }) {
  return (
    <Section id="ostot" title="Suurimmat ostot" sub="Ilman laskuja, tilauksia ja ruokakauppaa">
      <div className="grid two">
        <div className="table-wrap">
          <table>
            <tbody>
              {r.largest.slice(0, LARGEST_SHOWN).map((t) => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{date(t.date)}</td>
                  <td>
                    {t.merchant}
                    <div className="sub">{label(t.category)}</div>
                  </td>
                  <td className="num">
                    <strong>{money(t.cents)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!r.largest.length && <div className="empty">Ei ostoksia valitulla jaksolla.</div>}
        </div>
        <div className="table-wrap">
          <h3 className="small muted">Uudet kauppiaat</h3>
          <table>
            <tbody>
              {r.newMerchants.slice(0, NEW_SHOWN).map((m) => (
                <tr key={m.merchant}>
                  <td>
                    {m.merchant}
                    <div className="sub">
                      {label(m.category)} · ensimmäinen {date(m.firstDate)}
                    </div>
                  </td>
                  <td className="num">{m.count} kpl</td>
                  <td className="num">{money(m.totalCents, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!r.newMerchants.length && <div className="empty">Ei uusia kauppiaita.</div>}
        </div>
      </div>
    </Section>
  );
}
