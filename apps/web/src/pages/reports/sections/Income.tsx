// Decision: is our income changing, and does the buffer match how it moves
import { type IncomeChange, type IncomeReport, type IncomeTypeRow, printedEuros, printedParts } from "@banking/core";
import { Fragment, useState } from "react";
import { date, money, monthLong, percent, plural, roundedShares, shareText, signedMoney } from "../../../format.ts";
import { hasJointAccount } from "../../../part.ts";
import "../../../styles/income.css";
import { UnknownIncome } from "./Cashflow.tsx";
import { Why } from "../../../components/Why.tsx";
import { MonthLine, MonthLineTable } from "../../../charts/forms/MonthLine.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { BarCell, DeltaChip, SparkCell } from "../../../components/table/Cells.tsx";
import { DensitySwitch, DrillButton, RichTable, useDensity } from "../../../components/table/RichTable.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

const rowsHref = (payer: string, r: IncomeReport) => `#/transactions?merchant=${encodeURIComponent(payer)}&from=${r.months[0]!.month}-01`;

/** The changes of the usual income; the section mounts it only when there are some. */
function Changes({ r }: { r: IncomeReport }) {
  const [all, setAll] = useState(false);
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
          {all ? "Näytä vähemmän" : `Näytä kaikki (${r.changes.length})`}
        </button>
      )}
    </>
  );
}

/**
 * Type, then payer, then rows, each level opening under the one above it; the types grouped into earned income and the
 * rest (core's `kinds`), each group's figures on its row. The share is of earned income only, as the decision reads it.
 * Every level prints euros rounded together with its parts (core `printedParts`), so the rows add up to their group and
 * the groups to the head. `from` is the first of the report's months the page shows.
 */
function Types({ r, from }: { r: IncomeReport; from: number }) {
  const [density, setDensity] = useDensity("income");
  const [openType, setOpenType] = useState<string | null>(null);
  const [openPayer, setOpenPayer] = useState<string | null>(null);
  const toggle = (t: IncomeTypeRow) => {
    setOpenType((v) => (v === t.type ? null : t.type));
    setOpenPayer(null);
  };
  // the shares of the earned types are parts of the earned income: rounded together they add up to the 100 % it is
  const units = roundedShares(r.types.map((t) => (t.share === null ? null : t.totalCents)), r.earnedCents);
  const kindTotals = printedParts(r.kinds.map((k) => k.totalCents), r.totalCents);
  const kindChanges = r.kinds.map((k) => k.changeCents);
  const change = kindChanges.some((c) => c !== null);
  // one scale for every line of the table: a value picked, not a sum
  const scale = { lo: 0, hi: Math.max(0, ...r.types.flatMap((t) => t.months.slice(from))) };
  const shown = r.months.length;
  const columns = 6 + (change ? 1 : 0);
  return (
    <>
      <div className="rt-tools">
        <DensitySwitch density={density} onChange={setDensity} />
      </div>
      {change && <p className="qc-a">Muutos on samoihin valmiisiin kuukausiin vuotta aiemmin verrattuna.</p>}
      <RichTable density={density} className="income-types ruled">
        <thead>
          <tr>
            <th>Tulolaji</th>
            <th className="rt-spark-cell">Kuukaudet</th>
            <th className="num">Yhteensä</th>
            <th className="num income-month">Kuussa</th>
            <th className="rt-bar-cell" aria-hidden="true" />
            <th className="num">Osuus ansiotuloista</th>
            {change && <th className="num">Muutos</th>}
          </tr>
        </thead>
        {r.kinds.map((k, ki) => {
          const types = r.types.map((t, ti) => ({ t, ti })).filter(({ t }) => t.earned === k.earned);
          const totals = printedParts(types.map(({ t }) => t.totalCents), k.totalCents, kindTotals[ki]!);
          const changes = k.changeCents === null ? types.map(() => null) : printedParts(types.map(({ t }) => t.changeCents), k.changeCents);
          return (
            <tbody key={k.label}>
              <tr className="group-row rt-group">
                <td>
                  {k.label}
                  <span className="rt-group-count">{types.length}</span>
                </td>
                <td className="rt-spark-cell">
                  <Line values={k.months.slice(from)} scale={scale} label={`${k.label}: ${shown} kuukautta`} />
                </td>
                <td className="num">{money(kindTotals[ki]!, false)}</td>
                <td className="num income-month">{k.monthlyCents === null ? "–" : money(k.monthlyCents, false)}</td>
                <td className="rt-bar-cell">{k.earned && r.earnedCents > 0 ? <BarCell value={100} max={100} /> : null}</td>
                <td className="num">{k.earned && r.earnedCents > 0 ? "100 %" : "ei osuutta"}</td>
                {change && <td className="num">{k.changeCents === null ? "–" : <Delta cents={printedEuros(k.changeCents)} />}</td>}
              </tr>
              {types.map(({ t, ti }, at) => {
                const payers = printedParts(t.payers.map((p) => p.totalCents), t.totalCents, totals[at]!);
                return (
                  <Fragment key={t.type}>
                    <tr>
                      <td>
                        <DrillButton open={openType === t.type} onToggle={() => toggle(t)} label={`Maksajat: ${t.label}`} />
                        {t.label}
                      </td>
                      <td className="rt-spark-cell">
                        <Line values={t.months.slice(from)} scale={scale} label={`${t.label}: ${shown} kuukautta`} />
                      </td>
                      <td className="num">{money(totals[at]!, false)}</td>
                      <td className="num income-month">{t.monthlyCents === null ? "–" : money(t.monthlyCents, false)}</td>
                      <td className="rt-bar-cell">{t.share !== null && units[ti] ? <BarCell value={units[ti]!} max={100} /> : null}</td>
                      <td className="num">{t.share === null ? "ei osuutta" : units[ti] == null ? percent(t.share) : shareText(units[ti]!)}</td>
                      {change && <td className="num">{changes[at] == null ? "–" : <Delta cents={changes[at]!} />}</td>}
                    </tr>
                    {openType === t.type &&
                      t.payers.map((p, pi) => {
                        const key = `${t.type}|${p.payer}`;
                        return (
                          <Fragment key={key}>
                            <tr className="income-payer">
                              <td colSpan={2}>
                                <DrillButton open={openPayer === key} onToggle={() => setOpenPayer((v) => (v === key ? null : key))} label={`Maksut: ${p.payer}`} />
                                {p.payer}
                                <span className="income-note">
                                  {plural(p.payments, "maksu", "maksua")}, tavallisesti {money(p.usualCents)}
                                  {p.nextDate ? `, seuraava ${date(p.nextDate)}` : `, viimeksi ${date(p.lastDate)}`}
                                </span>
                              </td>
                              <td className="num">{money(payers[pi]!, false)}</td>
                              <td className="income-month" />
                              <td colSpan={change ? 3 : 2} />
                            </tr>
                            {openPayer === key && (
                              <tr className="income-rows rt-detail">
                                <td colSpan={columns}>
                                  <ul>
                                    {p.rows.map((x) => (
                                      <li key={x.id}>
                                        <span>{date(x.date)}</span>
                                        <span className="num">{money(x.amountCents)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                  <a href={rowsHref(p.payer, r)}>Näytä tapahtumat</a>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          );
        })}
      </RichTable>
    </>
  );
}

/** A month line of the table, on its shared scale; nothing under three months (two points are a slope, not a pattern). */
function Line({ values, scale, label }: { values: number[]; scale: { lo: number; hi: number }; label: string }) {
  return values.length >= 3 ? <SparkCell values={values} scale={scale} label={label} /> : null;
}

/** A change of income as CE1's chip: more money in is good; one that prints as no euro is "±0 €", level. */
function Delta({ cents }: { cents: number }) {
  return <DeltaChip delta={cents} text={signedMoney(cents)} meaning="gain" flat={99} />;
}

/**
 * The report's months from the first one with data: the months before the history starts are empty and
 * incomplete, and Viime vuosi of a history from September would show eight of them.
 */
function historyStart(months: IncomeReport["months"]): number {
  return Math.max(0, months.findIndex((m) => m.complete || m.totalCents !== 0));
}

/** The answer under the month line: the usual level, the weakest month when the income moves, the change in a year. */
function levelAnswer(r: IncomeReport, ctx: SectionProps["ctx"]) {
  const s = r.stability;
  const change = r.earnedChange === null ? null : Math.round(r.earnedChange * 100);
  const year = change === null ? "" : ` Ansiotulot samoihin kuukausiin vuotta aiemmin verrattuna: ${change === 0 ? "±0" : `${change > 0 ? "+" : "−"}${Math.abs(change)}`} %.`;
  if (!s) return `Tavallista tasoa varten tarvitaan ${r.needs.stabilityMonths} valmista kuukautta.${year}`;
  return (
    <>
      Säännölliset tulot ovat yleensä{" "}
      <strong>
        {/* the figure opens its months and their rows by a tap (owner rule): no link text */}
        <Why figure="usual.income" title="Säännölliset tulot kuussa" range={ctx.range} scope={ctx.scope} text={money(s.medianCents, false)}>
          {money(s.medianCents, false)}
        </Why>
      </strong>{" "}
      kuussa
      {s.steady ? ", ja ne ovat pysyneet tasaisina." : <>. Heikoin kuukausi oli {monthLong(s.lowMonth)}, <strong>{money(s.lowCents, false)}</strong>.</>}
      {year}
    </>
  );
}

function Income({ ctx }: SectionProps) {
  const from = historyStart(ctx.data.income.months);
  const r = { ...ctx.data.income, months: ctx.data.income.months.slice(from) };
  // the head and the two groups print euros that add up (core `printedParts`)
  const earned = printedParts([r.earnedCents, r.notEarnedCents], r.totalCents)[0] ?? 0;
  const s = r.stability;
  const months = r.months.map((m) => m.month);
  const values = r.months.map((m) => m.totalCents);
  const complete = r.months.map((m) => m.complete);
  const low = s && !s.steady ? months.indexOf(s.lowMonth) : -1;
  const top = r.types.find((t) => t.share !== null);
  return (
    <ReportPanel id={section.id} title={section.title} datum={`Tulot ${money(r.totalCents, false)}`}>
      <UnknownIncome share={r.unknownShare} range={r.window} />
      <QuestionChart id="tulot-taso" question="Tuleeko tuloja yhtä paljon kuin ennen?" answer={levelAnswer(r, ctx)} table={<MonthLineTable months={months} values={values} complete={complete} label="Tulot" />}>
        <MonthLine months={months} values={values} complete={complete} usual={s?.medianCents ?? null} usualLabel={s ? `Säännölliset tulot kuussa ${money(s.medianCents, false)}` : ""} marks={low >= 0 ? [{ at: low, label: "heikoin" }] : []} label="Tulot" />
      </QuestionChart>
      <hr className="qc-rule" />
      <QuestionChart
        id="tulot-lajit"
        question="Mistä tulot tulevat?"
        answer={
          <>
            Palkkoja, etuuksia ja muita ansiotuloja tuli <strong>{money(earned, false)}</strong>
            {top ? `, eniten: ${top.label.toLowerCase()}` : ""}.{r.fromPeopleCents >= 50 ? ` Maksuja henkilöiltä ja hyvityksiä tuli ${money(r.fromPeopleCents, false)}.` : ""}
          </>
        }
        table={<Types r={r} from={from} />}
      >
        <Types r={r} from={from} />
        {r.payDays.length > 0 && (
          <ul className="income-paydays">
            {r.payDays.map((p) => (
              <li key={`${p.label}|${p.payer}`}>
                {p.label}
                {p.label === "Palkka" ? ` (${p.payer})` : ""}: {p.text}
                {p.nextDate ? `, seuraava ${date(p.nextDate)}` : ""}, {money(p.usualCents, false)}
              </li>
            ))}
          </ul>
        )}
      </QuestionChart>
      {r.changes.length > 0 && (
        <>
          <hr className="qc-rule" />
          <h3 className="qc-q">Mikä tuloissa muuttui?</h3>
          <Changes r={r} />
        </>
      )}
      {r.members && (
        <>
          <hr className="qc-rule" />
          <h3 className="qc-q">Kenelle tulot tulevat?</h3>
          <ul className="income-paydays">
            {r.members.map((m) => (
              <li key={m.label}>
                {m.label}: {money(m.earnedCents, false)}
                {!m.regular && <span className="income-note">Palkkaa tai etuuksia ei näy jaetuilla tileillä.</span>}
              </li>
            ))}
          </ul>
          {hasJointAccount(ctx.meta) && <p className="income-caption">Yhteisen tilin tulot on jaettu jäsenten osuuksien mukaan.</p>}
        </>
      )}
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "tulot",
  title: "Tulot",
  order: 25,
  page: "reports",
  tab: "virta",
  reports: ["income"],
  // a history too short to split the income into types has nothing to tell: the section is left out until it has
  visible: (ctx) => ctx.data.income.enough,
  Component: Income,
};
