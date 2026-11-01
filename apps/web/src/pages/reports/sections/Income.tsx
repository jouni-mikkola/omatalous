// Decision: is our income changing, and does the buffer match how it moves
import { type IncomeChange, type IncomeReport, type IncomeTypeRow, printedEuros, printedParts } from "@banking/core";
import { useState } from "react";
import { date, money, monthLong, percent, plural, roundedShares, shareText, signedMoney } from "../../../format.ts";
import { hasJointAccount } from "../../../part.ts";
import "../../../styles/income.css";
import { UnknownIncome } from "./Cashflow.tsx";
import { Why } from "../../../components/Why.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { inSpan } from "../parts.tsx";
import { BarFigure, DeltaChip, SparkCell } from "../../../components/table/Cells.tsx";
import { type Column, DrillButton, Table } from "../../../components/table/Table.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import { Button } from "../../../components/ui/Button.tsx";
import { rich, t } from "../../../text.ts";
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
            <span className="muted">
              {c.detail}
            </span>
            {c.payer && (
              <a href={rowsHref(c.payer, r)} className="income-link">
                {t("rpt.in_transactions")}
              </a>
            )}
          </li>
        ))}
      </ul>
      {r.changes.length > 3 && (
        <Button onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? t("rpt.in_less") : t("rpt.in_all", { n: r.changes.length })}
        </Button>
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
  const [openType, setOpenType] = useState<string | null>(null);
  const [openPayer, setOpenPayer] = useState<string | null>(null);
  // the shares of the earned types are parts of the earned income: rounded together they add up to the 100 % it is
  const units = roundedShares(r.types.map((ty) => (ty.share === null ? null : ty.totalCents)), r.earnedCents);
  const kindTotals = printedParts(r.kinds.map((k) => k.totalCents), r.totalCents);
  const kindChanges = r.kinds.map((k) => k.changeCents);
  const change = kindChanges.some((c) => c !== null);
  // one scale for every line of the table: a value picked, not a sum
  const scale = { lo: 0, hi: Math.max(0, ...r.types.flatMap((ty) => ty.months.slice(from))) };
  const shown = r.months.length;
  // what each type prints: its euros rounded together with its group's, and its change likewise
  const printed = new Map<string, { total: number; change: number | null; payers: (number | null)[] }>();
  const kinds = r.kinds.map((k, ki) => {
    const types = r.types.filter((ty) => ty.kind === k.id);
    const totals = printedParts(types.map((ty) => ty.totalCents), k.totalCents, kindTotals[ki]!);
    const changes = k.changeCents === null ? types.map(() => null) : printedParts(types.map((ty) => ty.changeCents), k.changeCents);
    types.forEach((ty, at) => printed.set(ty.type, { total: totals[at]!, change: changes[at] ?? null, payers: printedParts(ty.payers.map((p) => p.totalCents), ty.totalCents, totals[at]!) }));
    return { k, ki, types };
  });
  const shareOf = (ty: IncomeTypeRow) => (ty.share === null ? t("rpt.in_no_share") : units[r.types.indexOf(ty)] == null ? percent(ty.share) : shareText(units[r.types.indexOf(ty)]!));
  const columns: Column<IncomeTypeRow>[] = [
    { key: "type", label: t("rpt.in_type"), kind: "text", rowHead: true, cell: (ty) => ty.label },
    { key: "months", label: t("rpt.dr_months"), kind: "text", phone: "hide", cell: (ty) => <Line values={ty.months.slice(from)} scale={scale} label={t("rpt.in_spark", { label: ty.label, n: shown })} /> },
    { key: "total", label: t("rpt.total"), kind: "money", main: true, cell: (ty) => money(printed.get(ty.type)!.total, false) },
    { key: "month", label: t("rpt.in_a_month"), kind: "money", cell: (ty) => (ty.monthlyCents === null ? "–" : money(ty.monthlyCents, false)) },
    {
      key: "share",
      label: t("rpt.in_share"),
      kind: "share",
      cell: (ty) => {
        const u = units[r.types.indexOf(ty)];
        return <BarFigure value={ty.share !== null && u ? u : 0} max={100}>{shareOf(ty)}</BarFigure>;
      },
    },
    ...(change ? [{ key: "change", label: t("rpt.change"), kind: "money" as const, cell: (ty: IncomeTypeRow) => (printed.get(ty.type)!.change == null ? "–" : <Delta cents={printed.get(ty.type)!.change!} />) }] : []),
  ];
  return (
    <>
      {change && <p className="qc-a">{t("rpt.in_change_note")}</p>}
      <Table<IncomeTypeRow>
        caption={t("rpt.in_types")}
        className="income-types"
        rows={r.types}
        rowKey={(ty) => ty.type}
        columns={columns}
        // a group of one type repeats that type's row, so the groups stand only when one of them holds several
        groups={kinds.every(({ types }) => types.length < 2) ? undefined : kinds.map(({ k, ki, types }) => ({
          key: k.label,
          title: (
            <>
              {k.label}
              <span className="rt-group-count">{types.length}</span>
            </>
          ),
          cells: {
            months: <Line values={k.months.slice(from)} scale={scale} label={t("rpt.in_spark", { label: k.label, n: shown })} />,
            total: money(kindTotals[ki]!, false),
            month: k.monthlyCents === null ? "–" : money(k.monthlyCents, false),
            share: <BarFigure value={k.earned && r.earnedCents > 0 ? 100 : 0} max={100}>{k.earned && r.earnedCents > 0 ? "100 %" : t("rpt.in_no_share")}</BarFigure>,
            ...(change ? { change: k.changeCents === null ? "–" : <Delta cents={printedEuros(k.changeCents)} /> } : {}),
          },
          rows: types,
        }))}
        open={openType}
        onOpen={(key) => {
          setOpenType(key);
          setOpenPayer(null);
        }}
        drill={(ty) => <Payers r={r} ty={ty} printed={printed.get(ty.type)!.payers} open={openPayer} onOpen={setOpenPayer} />}
        drillLabel={(ty) => t("rpt.in_payers", { label: ty.label })}
      />
    </>
  );
}

/** The payers of a type under its row, each with its usual payment and, opened, its rows. */
function Payers({ r, ty, printed, open, onOpen }: { r: IncomeReport; ty: IncomeTypeRow; printed: (number | null)[]; open: string | null; onOpen: (key: string | null) => void }) {
  return (
    <ul className="income-payers">
      {ty.payers.map((p, pi) => {
        const key = `${ty.type}|${p.payer}`;
        return (
          <li key={key}>
            <div className="income-payer">
              <DrillButton open={open === key} onToggle={() => onOpen(open === key ? null : key)} label={t("rpt.in_payments", { payer: p.payer })} />
              <span>
                {p.payer}
                <span className="income-note">
                  {t("rpt.in_payer_line", { count: plural(p.payments, t("rpt.u_payment"), t("rpt.u_payments")), usual: money(p.usualCents) })}
                  {p.nextDate ? t("rpt.in_next", { date: date(p.nextDate) }) : t("rpt.in_last", { date: date(p.lastDate) })}
                </span>
              </span>
              <span className="num">{money(printed[pi] ?? p.totalCents, false)}</span>
            </div>
            {open === key && (
              <div className="income-rows">
                <ul>
                  {p.rows.map((x) => (
                    <li key={x.id}>
                      <span>{date(x.date)}</span>
                      <span className="num">{money(x.amountCents)}</span>
                    </li>
                  ))}
                </ul>
                <a href={rowsHref(p.payer, r)}>{t("rpt.cf_show")}</a>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A month line of the table, on its shared scale; nothing under three months (two points are a slope, not a pattern). */
function Line({ values, scale, label }: { values: (number | null)[]; scale: { lo: number; hi: number }; label: string }) {
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
  const year = change === null ? "" : ` ${t("rpt.in_year", { change: change === 0 ? "±0" : `${change > 0 ? "+" : "−"}${Math.abs(change)}` })}`;
  if (!s) return `${t("rpt.in_needs", { n: r.needs.stabilityMonths })}${year}`;
  return (
    <>
      {/* the figure opens its months and their rows by a tap (owner rule): no link text */}
      {rich(
        "rpt.in_usual",
        {},
        {
          amount: (
            <Why figure="usual.income" title={t("rpt.in_why")} range={ctx.range} scope={ctx.scope} text={money(s.medianCents, false)}>
              {money(s.medianCents, false)}
            </Why>
          ),
        },
      )}
      {s.steady ? t("rpt.in_steady") : rich("rpt.in_weakest", { month: monthLong(s.lowMonth), amount: money(s.lowCents, false) })}
      {year}
    </>
  );
}

function Income({ ctx }: SectionProps) {
  const from = historyStart(ctx.data.income.months);
  const r = { ...ctx.data.income, months: ctx.data.income.months.slice(from) };
  // the head and the two groups print euros that add up (core `printedParts`)
  const earned = printedParts([r.earnedCents, r.notEarnedCents], r.totalCents)[0] ?? 0;
  const top = r.types.find((ty) => ty.share !== null);
  return (
    <ReportPanel id={section.id} title={section.title} datum={inSpan(ctx, t("rpt.in_datum", { amount: money(r.totalCents, false) }))}>
      <UnknownIncome share={r.unknownShare} range={r.window} />
      <QuestionChart id="tulot-taso" question={t("rpt.in_q_level")} answer={levelAnswer(r, ctx)} />
      <hr className="qc-rule" />
      <QuestionChart
        id="tulot-lajit"
        question={t("rpt.in_q_sources")}
        answer={
          <>
            {rich("rpt.in_sources", { amount: money(earned, false) })}
            {top ? t("rpt.in_most", { label: top.label.toLowerCase() }) : ""}.{r.fromPeopleCents >= 50 ? ` ${t("rpt.in_people", { amount: money(r.fromPeopleCents, false) })}` : ""}
          </>
        }
      >
        <Types r={r} from={from} />
        {r.payDays.length > 0 && (
          <ul className="income-paydays">
            {r.payDays.map((p) => (
              <li key={`${p.label}|${p.payer}`}>
                {p.label}
                {p.label === t("income.type_salary") ? ` (${p.payer})` : ""}: {p.text}
                {p.nextDate ? t("rpt.in_next", { date: date(p.nextDate) }) : ""}, {money(p.usualCents, false)}
              </li>
            ))}
          </ul>
        )}
      </QuestionChart>
      {r.changes.length > 0 && (
        <>
          <hr className="qc-rule" />
          <h3 className="qc-q">{t("rpt.in_q_changed")}</h3>
          <Changes r={r} />
        </>
      )}
      {r.members && (
        <>
          <hr className="qc-rule" />
          <h3 className="qc-q">{t("rpt.in_q_whose")}</h3>
          <ul className="income-paydays">
            {r.members.map((m) => (
              <li key={m.label}>
                {m.label}: {money(m.earnedCents, false)}
                {!m.regular && <span className="income-note">{t("rpt.in_no_regular")}</span>}
              </li>
            ))}
          </ul>
          {hasJointAccount(ctx.meta) && <p className="income-caption">{t("rpt.in_joint")}</p>}
        </>
      )}
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "tulot",
  get title() {
    return t("rpt.sec_income");
  },
  order: 25,
  page: "reports",
  reports: ["income"],
  // a history too short to split the income into types has nothing to tell: the section is left out until it has
  visible: (ctx) => ctx.data.income.enough,
  Component: Income,
};
