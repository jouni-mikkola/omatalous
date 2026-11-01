// Decision: which of the food lines to look at first, and whether the bill grew by visits or by dearer baskets

import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { Slope } from "../../../charts/forms/Slope.tsx";
import { printedParts } from "@banking/core";
import {
  BarCell,
  BarFigure,
  DeltaChip,
  SparkCell,
} from "../../../components/table/Cells.tsx";
import {
  type Column,
  Table,
} from "../../../components/table/Table.tsx";
import {
  decimalMax1,
  mondayFirstWeekdays,
  monthLabel,
  money,
  roundedShares,
  shareText,
  signedMoney,
} from "../../../format.ts";
import type { ReportsData } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { rich, t } from "../../../text.ts";

type FoodReport = Exclude<NonNullable<ReportsData["food"]>, { gap: unknown }>;
type Line = FoodReport["lines"][number];

/** Visits a month with the language's decimal mark; a whole number has none. */
const count = (x: number | null) => (x === null ? "" : decimalMax1(x));

/** The answer about the basket: visits and the mean purchase, now and before, each a server figure. */
function basketAnswer(b: FoodReport["basket"]) {
  if (!b || b.now.meanCents === null || b.before.meanCents === null)
    return t("rpt.fd_basket_none");
  return rich("rpt.fd_basket", { now: count(b.now.perMonth), before: count(b.before.perMonth), mean: money(b.now.meanCents, false), meanBefore: money(b.before.meanCents, false) });
}

/** What an open line holds: its payees as bars against the largest, and the weekdays of its visits. */
function LineDetail({ line }: { line: Line }) {
  const top = Math.max(...line.payees.map((p) => p.cents), 1);
  const weekdays = mondayFirstWeekdays();
  const busiest = line.weekdays ? Math.max(...line.weekdays, 1) : 1;
  // the payees and Muut make up the line: their euros rounded together to the line's (core `printedParts`)
  const printed = printedParts(
    [...line.payees.map((p) => p.cents), line.otherCents],
    line.cents,
  );
  return (
    <div className="food-open qc-pair">
      {line.payees.length > 0 && (
        <ul className="rt-months">
          {line.payees.map((p, pi) => (
            <li key={p.payee}>
              <span className="rt-month" title={p.payee}>
                {p.payee}
              </span>
              <BarCell value={p.cents} max={top} />
              <span className="num">{money(printed[pi]!, false)}</span>
            </li>
          ))}
          {line.otherCents !== 0 && (
            <li>
              <span className="rt-month">{t("rpt.fd_other")}</span>
              <span />
              <span className="num">
                {money(printed[line.payees.length]!, false)}
              </span>
            </li>
          )}
        </ul>
      )}
      {line.weekdays && (
        <ul className="rt-months" aria-label={t("rpt.fd_weekdays")}>
          {line.weekdays.map((n, i) => (
            <li
              key={weekdays[i]}
              className={n === busiest ? "rt-peak" : undefined}
            >
              <span className="rt-month">{weekdays[i]}</span>
              <BarCell value={n} max={busiest} />
              <span className="num">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "loka 2025–syys 2026": the months a figure of the table is over. */
const span = (w: FoodReport["window"]) =>
  w.first === w.last
    ? monthLabel(w.first, true)
    : `${monthLabel(w.first, true)}–${monthLabel(w.last, true)}`;

/**
 * The lines as a table: monthly spend with its months as a line, share of food, the basket figures and the change. The
 * sentence over it names the months each figure is over and what the change is set against, since the basket answer
 * above reads the newest three months and the table the whole window. An empty cell says why in words.
 */
function Lines({ r }: { r: FoodReport }) {
  // the shares of the lines that spent; a line at or under zero has none. The base is the web's sum of those lines
  // until core sends each line's share (PD-raportit 5)
  const shares = roundedShares(
    r.lines.map((l) => (l.cents > 0 ? l.cents : null)),
    r.lines.reduce((s, l) => s + Math.max(0, l.cents), 0),
  );
  // the monthly euros of the lines, rounded together to the total's when they make it up (core `printedParts`)
  const monthly = printedParts(
    r.lines.map((l) => l.monthlyCents),
    r.monthlyCents,
  );
  const change = r.lines.some((l) => l.changeCents !== null);
  // a line's change is null when core has no figure for it: the cell is a dash and claims no "usual" level, since a line
  // over its usual range for months can have null too (Nousseet below says so)
  const usualOnly = r.window.months >= 9;
  type Row = { id: string; line: Line; i: number };
  const rows: Row[] = r.lines.map((l, i) => ({ id: l.id, line: l, i }));
  const dash = <span className="muted">–</span>;
  const cols: Column<Row>[] = [
    {
      key: "heading",
      label: t("rpt.fd_food"),
      kind: "text",
      rowHead: true,
      cell: (x) => x.line.heading,
    },
    {
      key: "months",
      label: t("rpt.fd_trend"),
      kind: "text",
      phone: "hide",
      cell: (x) =>
        x.line.monthCents.length >= 3 ? (
          <SparkCell
            values={x.line.monthCents}
            label={t("rpt.in_spark", { label: x.line.heading, n: x.line.monthCents.length })}
          />
        ) : null,
    },
    {
      key: "monthly",
      label: t("rpt.in_a_month"),
      kind: "money",
      main: true,
      sort: true,
      cents: (x) => monthly[x.i]!,
    },
    {
      key: "share",
      label: t("rpt.fd_share"),
      kind: "share",
      bar: { value: (x) => shares[x.i] ?? 0, max: 100 },
      cell: (x) =>
        shares[x.i] == null ? (
          <span className="muted">{t("rpt.in_no_share")}</span>
        ) : (
          shareText(shares[x.i]!)
        ),
    },
    {
      key: "mean",
      label: t("rpt.fd_basket_col"),
      kind: "money",
      phone: "hide",
      // under six purchases a mean says nothing: the cell says there were too few
      cell: (x) =>
        x.line.meanCents === null ? (
          <span className="muted">{t("rpt.fd_too_few")}</span>
        ) : (
          money(x.line.meanCents, false)
        ),
    },
    {
      key: "perMonth",
      label: t("rpt.fd_times_month"),
      kind: "count",
      phone: "hide",
      cell: (x) => (x.line.perMonth === null ? dash : count(x.line.perMonth)),
    },
    ...(change || usualOnly
      ? [
          {
            key: "change",
            label: t("rpt.fd_change"),
            kind: "money" as const,
            cell: (x: Row) =>
              x.line.changeCents !== null ? (
                <DeltaChip
                  delta={x.line.changeCents}
                  text={signedMoney(x.line.changeCents)}
                  meaning="spend"
                  flat={99}
                />
              ) : (
                dash
              ),
          },
        ]
      : []),
  ];
  const hasShares = shares.some((x) => x != null);
  return (
    <>
      <p className="qc-a food-base">
        {t("rpt.fd_base", { n: r.window.months, span: span(r.window) })}
        {change || usualOnly ? t("rpt.fd_base_change") : ""}
      </p>
      <Table
        caption={t("rpt.fd_lines_caption")}
        className="food-lines"
        rows={rows}
        rowKey={(x) => x.id}
        columns={cols}
        drill={(x) =>
          x.line.payees.length > 0 || x.line.weekdays ? (
            <LineDetail line={x.line} />
          ) : null
        }
        drillLabel={(x) => t("rpt.fd_merchants", { heading: x.line.heading })}
        total={{
          label: t("rpt.fd_total"),
          cells: {
            monthly: <strong>{money(r.monthlyCents, false)}</strong>,
            share: hasShares ? <BarFigure value={100} max={100}>100 %</BarFigure> : "",
          },
        }}
      />
    </>
  );
}

function Food({ ctx }: SectionProps) {
  const found = ctx.data.food!;
  // card bills without their purchases: no figure of food is told, one row says why
  if ("gap" in found)
    return (
      <ReportPanel id={section.id} title={section.title}>
        <p className="question-line">{found.gap.text}</p>
      </ReportPanel>
    );
  const r = found;
  const b = r.basket;
  const both =
    b &&
    b.now.meanCents !== null &&
    b.before.meanCents !== null &&
    b.now.perMonth !== null &&
    b.before.perMonth !== null;
  const top = r.lines.reduce<Line | null>(
    (best, l) => (best === null || l.cents > best.cents ? l : best),
    null,
  );
  // the two basket lines are the rows of the table under them; a mark of either slope keeps its row
  const basketRows =
    both && b
      ? [
          { key: "visits", label: t("rpt.fd_visits_month"), before: t("rpt.fd_n_times", { n: count(b.before.perMonth!) }), now: t("rpt.fd_n_times", { n: count(b.now.perMonth!) }) },
          { key: "mean", label: t("rpt.fd_avg_basket"), before: money(b.before.meanCents!, false), now: money(b.now.meanCents!, false) },
        ]
      : [];
  return (
    <ReportPanel
      id={section.id}
      title={section.title}
      datum={t("rpt.fd_datum", { amount: money(r.monthlyCents, false) })}
    >
      <QuestionChart
        id="ruoka-kauppa"
        question={t("rpt.fd_q_basket")}
        answer={basketAnswer(b)}
        table={
          basketRows.length > 0 ? (
            <Table
              caption={t("rpt.fd_basket_caption")}
              rows={basketRows}
              rowKey={(row) => row.key}
              columns={[
                { key: "line", label: t("rpt.fd_figure"), kind: "text", rowHead: true, cell: (row) => row.label },
                { key: "before", label: t("rpt.fd_before"), kind: "text", cell: (row) => row.before },
                { key: "now", label: t("rpt.fd_last3"), kind: "text", cell: (row) => row.now },
              ]}
            />
          ) : undefined
        }
      >
        {both && (
          <div className="qc-pair">
            <Slope
              items={[
                {
                  key: "visits",
                  label: t("rpt.fd_times_month"),
                  from: b.before.perMonth!,
                  to: b.now.perMonth!,
                  strong: true,
                  tone: "flat",
                },
              ]}
              fromLabel={t("rpt.fd_before")}
              toLabel={t("rpt.fd_last3")}
              format={(v) => t("rpt.fd_n_times", { n: count(v) })}
              label={t("rpt.fd_visits_label")}
              caption={t("rpt.fd_visits_month")}
              height={120}
              zero={false}
            />
            <Slope
              items={[
                {
                  key: "mean",
                  label: t("rpt.fd_basket_col"),
                  from: b.before.meanCents!,
                  to: b.now.meanCents!,
                  strong: true,
                  tone: b.now.meanCents! > b.before.meanCents! ? "bad" : "good",
                },
              ]}
              fromLabel={t("rpt.fd_before")}
              toLabel={t("rpt.fd_last3")}
              format={(v) => money(v, false)}
              label={t("rpt.fd_basket_label")}
              caption={t("rpt.fd_avg_basket")}
              height={120}
              zero={false}
            />
          </div>
        )}
      </QuestionChart>
      <hr className="qc-rule" />
      <QuestionChart
        id="ruoka-lajit"
        question={t("rpt.fd_q_where")}
        answer={
          top
            ? rich("rpt.fd_where", { amount: money(r.monthlyCents, false), top: top.heading.toLowerCase(), topAmount: money(top.monthlyCents, false) })
            : t("rpt.fd_none")
        }
      >
        <Lines r={r} />
      </QuestionChart>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "ruoka",
  get title() {
    return t("rpt.sec_food");
  },
  order: 35,
  page: "reports",
  reports: ["food"],
  // under three months there is no window, and without food there is nothing to tell
  visible: (ctx) => ctx.data.food != null,
  Component: Food,
};
