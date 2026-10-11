// Decision: is our income changing, and does the buffer match how it moves
import type { IncomeChange, IncomeReport, IncomeTypeRow } from "@banking/core";
import { Fragment, useState } from "react";
import { type StackSeries, StackedColumns } from "../../../charts/StackedColumns.tsx";
import { completeMonths, date, money, MONTHS_SHORT, monthLong, percent, plural } from "../../../format.ts";
import "../../../styles/income.css";
import { Kv, TableToggle } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/** Chart layers in the fixed order of the core groups; money that is not earned is the neutral gray. */
const groupColor = (i: number, id: string) => (id === "not_earned" ? "var(--series-rest)" : `var(--series-${i + 1})`);

/** ["2025-10", ..., "2026-09"] → "lokakuu 2025–syyskuu 2026" */
function span(first: string, last: string): string {
  const name = (m: string) => `${MONTHS_SHORT[Number(m.slice(5, 7)) - 1]}kuu`;
  return first.slice(0, 4) === last.slice(0, 4) ? `${MONTHS_SHORT[Number(first.slice(5, 7)) - 1]}–${name(last)} ${last.slice(0, 4)}` : `${name(first)} ${first.slice(0, 4)}–${name(last)} ${last.slice(0, 4)}`;
}

function signedPercent(x: number): string {
  if (Math.round(x * 100) === 0) return "±0 %";
  return x > 0 ? `+${percent(x)}` : percent(x);
}

const rowsHref = (payer: string, r: IncomeReport) => `#/transactions?merchant=${encodeURIComponent(payer)}&from=${r.months[0]!.month}-01`;

function Changes({ r }: { r: IncomeReport }) {
  const [all, setAll] = useState(false);
  if (!r.changes.length) return <p className="muted">Ei muutoksia tavallisiin tuloihin 12 kuukaudessa.</p>;
  const shown: IncomeChange[] = all ? r.changes : r.changes.slice(0, 3);
  return (
    <>
      <ul className="income-changes">
        {shown.map((c) => (
          <li key={c.id} className={c.monthlyCents < 0 ? "down" : "up"}>
            <strong>{c.title}</strong>
            <span className="muted">{c.detail}</span>
            {c.payer && (
              <a href={rowsHref(c.payer, r)} className="income-link">
                Tapahtumat
              </a>
            )}
          </li>
        ))}
      </ul>
      {r.changes.length > 3 && (
        <button className="btn btn-small" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Näytä kolme" : `Näytä kaikki (${r.changes.length})`}
        </button>
      )}
    </>
  );
}

/** Type, then payer, then rows: each level opens under the one above it. */
function Types({ r }: { r: IncomeReport }) {
  const [openType, setOpenType] = useState<string | null>(null);
  const [openPayer, setOpenPayer] = useState<string | null>(null);
  const toggle = (t: IncomeTypeRow) => {
    setOpenType((v) => (v === t.type ? null : t.type));
    setOpenPayer(null);
  };
  return (
    <div className="table-wrap">
      <table className="income-types">
        <thead>
          <tr>
            <th>Tulolaji</th>
            <th className="num">Yhteensä</th>
            <th className="num">Kuussa</th>
            <th className="num">Osuus</th>
          </tr>
        </thead>
        <tbody>
          {r.types.map((t) => (
            <Fragment key={t.type}>
              <tr className={t.earned ? "" : "not-earned"}>
                <td>
                  <button className="link-button" onClick={() => toggle(t)} aria-expanded={openType === t.type}>
                    {t.label}
                  </button>
                  {!t.earned && <span className="income-note">ei ansiotuloa</span>}
                </td>
                <td className="num">{money(t.totalCents, false)}</td>
                <td className="num">{t.monthlyCents === null ? "–" : money(t.monthlyCents, false)}</td>
                <td className="num">{t.share === null ? "–" : percent(t.share)}</td>
              </tr>
              {openType === t.type &&
                t.payers.map((p) => {
                  const key = `${t.type}|${p.payer}`;
                  return (
                    <Fragment key={key}>
                      <tr className="income-payer">
                        <td>
                          <button className="link-button" onClick={() => setOpenPayer((v) => (v === key ? null : key))} aria-expanded={openPayer === key}>
                            {p.payer}
                          </button>
                          <span className="income-note">
                            {plural(p.payments, "maksu", "maksua")}, tavallisesti {money(p.usualCents)}
                            {p.nextDate ? `, seuraava ${date(p.nextDate)}` : `, viimeksi ${date(p.lastDate)}`}
                          </span>
                        </td>
                        <td className="num">{money(p.totalCents, false)}</td>
                        <td />
                        <td />
                      </tr>
                      {openPayer === key && (
                        <tr className="income-rows">
                          <td colSpan={4}>
                            <ul>
                              {p.rows.map((x) => (
                                <li key={x.id}>
                                  <span>{date(x.date)}</span>
                                  <span className="num">{money(x.amountCents)}</span>
                                </li>
                              ))}
                            </ul>
                            <a href={rowsHref(p.payer, r)}>Näytä tapahtumissa</a>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Year({ r }: { r: IncomeReport }) {
  const [table, setTable] = useState(false);
  const months = [...r.months.map((m) => m.month), ...r.projection.map((p) => p.month)];
  const past = new Set(r.months.map((m) => m.month));
  const series: StackSeries[] = r.groups.map((g, i) => ({
    key: g.id,
    label: g.label,
    color: groupColor(i, g.id),
    // a month with a returned salary can sum below zero: the chart stacks what came in, the table shows the sum
    values: [...r.months.map((m) => Math.max(0, m.byGroup[g.id])), ...r.projection.map((p) => p.byGroup[g.id])],
  }));
  const used = series.filter((s) => s.values.some((v) => v > 0));
  return (
    <div className="income-year">
      <div className="income-year-head">
        <h3>Kuukausittain</h3>
        <TableToggle table={table} onToggle={() => setTable((v) => !v)} />
      </div>
      {table ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kuukausi</th>
                {used.map((s) => (
                  <th key={s.key} className="num">
                    {s.label}
                  </th>
                ))}
                <th className="num">Yhteensä</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => (
                <tr key={m} className={past.has(m) ? "" : "projected"}>
                  <td>
                    {monthLong(m)}
                    {past.has(m) ? (r.months[i]!.complete ? "" : " (vajaa)") : " (arvio)"}
                  </td>
                  {used.map((s) => (
                    <td key={s.key} className="num">
                      {money(past.has(m) ? r.months[i]!.byGroup[s.key as keyof IncomeReport["months"][number]["byGroup"]] : s.values[i]!, false)}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{money(past.has(m) ? r.months[i]!.totalCents : used.reduce((sum, s) => sum + s.values[i]!, 0), false)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <StackedColumns months={months} series={used} highlight={(m) => past.has(m)} label="Tulot kuukausittain tulolajeittain" />
      )}
      {r.projection.length > 0 && <p className="income-caption">Himmeät sarakkeet ovat arvio säännöllisistä tuloista.</p>}
      {r.markers.length > 0 && (
        <p className="income-caption">
          Viime vuonna lisäksi {r.markers.map((m) => `${m.label.toLowerCase()} ${money(m.cents, false)} (${monthLong(m.month).split(" ")[0]})`).join(", ")}. {r.markers.length === 1 ? "Se ei ole" : "Ne eivät ole"} arviossa.
        </p>
      )}
    </div>
  );
}

function Stability({ r }: { r: IncomeReport }) {
  const s = r.stability;
  if (!s) return <p className="muted">Tulojen vaihtelu lasketaan, kun historiaa on {completeMonths(r.needs.stabilityMonths)}.</p>;
  if (s.steady) return <p>Säännölliset tulot vaihtelivat alle {percent(r.needs.steadySpread)} kuukaudesta toiseen, tavallisesti {money(s.medianCents, false)} kuussa.</p>;
  const weeks = s.worstRunWeeks.toLocaleString("fi-FI", { maximumFractionDigits: 1 });
  return (
    <>
      <Kv
        items={[
          ["Säännölliset tulot tavallisesti", money(s.medianCents, false)],
          ["Vaihtelu kuukaudesta toiseen", percent(s.spread)],
          ["Heikoin kuukausi", `${monthLong(s.lowMonth)}, ${money(s.lowCents, false)}`],
        ]}
      />
      <p>
        Heikoin kuukausi oli {percent(s.lowShare)} tavallista pienempi. Suurin vajaus peräkkäisinä kuukausina oli {money(s.worstRunCents, false)} eli {weeks} viikon tulot.
      </p>
    </>
  );
}

function Income({ ctx }: SectionProps) {
  const r = ctx.data.income;
  const first = r.months[0]!.month;
  const last = r.months[r.months.length - 1]!.month;
  if (!r.enough) {
    return (
      <Section id={section.id} title={section.title}>
        <div className="empty">
          Tulot jaetaan tulolajeihin, kun historiaa on {completeMonths(r.needs.compositionMonths)}. Vertailu edelliseen vuoteen tarvitsee {plural(r.needs.previousYearMonths, "kuukauden", "kuukautta")}.
        </div>
      </Section>
    );
  }
  const change = r.earnedChange;
  return (
    <Section id={section.id} title={section.title} sub={`${span(first, last)}, ansiotulot ilman henkilöiltä saatuja ja hyvityksiä`}>
      <Kv
        items={[
          ["Ansiotulot 12 kuukaudessa", money(r.earnedCents, false)],
          ...(change === null ? [] : ([["Edellisestä 12 kuukaudesta", signedPercent(change)]] as [string, string][])),
          ...(r.notEarnedCents ? ([["Henkilöiltä ja hyvityksinä", money(r.notEarnedCents, false)]] as [string, string][]) : []),
        ]}
      />
      <h3>Mikä muuttui</h3>
      <Changes r={r} />
      <h3>Tulolajit</h3>
      <Types r={r} />
      <Year r={r} />
      {r.payDays.length > 0 && (
        <>
          <h3>Maksupäivät</h3>
          <ul className="income-paydays">
            {r.payDays.map((p) => (
              <li key={`${p.label}|${p.payer}`}>
                {p.label}
                {p.label === "Palkka" ? ` (${p.payer})` : ""}: {p.text}
                {p.nextDate ? `, seuraava ${date(p.nextDate)}` : ""}, {money(p.usualCents, false)}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Vaihtelu</h3>
      <Stability r={r} />
      {r.members && (
        <>
          <h3>Jäsenittäin</h3>
          <ul className="income-paydays">
            {r.members.map((m) => (
              <li key={m.label}>
                {m.label}: {money(m.earnedCents, false)}
                {!m.regular && <span className="income-note">Palkkaa tai etuuksia ei näy jaetuilla tileillä.</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

export const section: ReportSection = {
  id: "tulot",
  title: "Tulot",
  order: 25,
  page: "reports",
  reports: ["income"],
  Component: Income,
};
