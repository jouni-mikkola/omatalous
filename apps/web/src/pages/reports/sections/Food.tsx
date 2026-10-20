// Decision: which of the food lines to look at first, and whether the bill grew by visits or by dearer baskets

import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { Slope } from "../../../charts/forms/Slope.tsx";
import { printedParts } from "@banking/core";
import {
  BarCell,
  DeltaChip,
  SparkCell,
} from "../../../components/table/Cells.tsx";
import {
  type Column,
  DataTable,
} from "../../../components/table/DataTable.tsx";
import {
  monthLabel,
  money,
  roundedShares,
  shareText,
  signedMoney,
} from "../../../format.ts";
import type { ReportsData } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";

type FoodReport = NonNullable<ReportsData["food"]>;
type Line = FoodReport["lines"][number];

/** Visits a month with a decimal comma; a whole number has none. */
const count = (x: number | null) =>
  x === null ? "" : String(x).replace(".", ",");
/** Monday first, as the report counts. */
const WEEKDAYS = ["ma", "ti", "ke", "to", "pe", "la", "su"];

/** The answer about the basket: visits and the mean purchase, now and before, each a server figure. */
function basketAnswer(b: FoodReport["basket"]) {
  if (!b || b.now.meanCents === null || b.before.meanCents === null)
    return "Ostoskertojen vertailuun ei ole vielä tarpeeksi kuukausia tai ostoskertoja.";
  return (
    <>
      Ruokakaupassa käytiin viimeiset kolme kuukautta{" "}
      <strong>{count(b.now.perMonth)}</strong> kertaa kuussa, sitä ennen{" "}
      {count(b.before.perMonth)}. Ostoskerta oli keskimäärin{" "}
      <strong>{money(b.now.meanCents, false)}</strong>, sitä ennen{" "}
      {money(b.before.meanCents, false)}.
    </>
  );
}

/** What an open line holds: its payees as bars against the largest, and the weekdays of its visits. */
function LineDetail({ line }: { line: Line }) {
  const top = Math.max(...line.payees.map((p) => p.cents), 1);
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
              <span className="rt-month">Muut</span>
              <span />
              <span className="num">
                {money(printed[line.payees.length]!, false)}
              </span>
            </li>
          )}
        </ul>
      )}
      {line.weekdays && (
        <ul className="rt-months" aria-label="Ostoskerrat viikonpäivittäin">
          {line.weekdays.map((n, i) => (
            <li
              key={WEEKDAYS[i]}
              className={n === busiest ? "rt-peak" : undefined}
            >
              <span className="rt-month">{WEEKDAYS[i]}</span>
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
  type Row = { id: string; line: Line | null; i: number };
  const rows: Row[] = [
    ...(r.cardBills ? [{ id: "card-bills", line: null, i: -1 }] : []),
    ...r.lines.map((l, i) => ({ id: l.id, line: l, i })),
  ];
  const dash = <span className="muted">–</span>;
  const cols: Column<Row>[] = [
    {
      key: "heading",
      label: "Ruoka",
      kind: "text",
      cell: (x) =>
        x.line ? (
          x.line.heading
        ) : (
          <>
            Luottokortin laskut
            <span className="food-note">
              Laskun ostot eivät näy ruokariveinä, joten niillä ei ole osuutta
              eikä ostoskertoja.
            </span>
          </>
        ),
    },
    {
      key: "months",
      label: "Kuukaudet",
      kind: "text",
      className: () => "rt-spark-cell",
      cell: (x) =>
        x.line && x.line.monthCents.length >= 3 ? (
          <SparkCell
            values={x.line.monthCents}
            label={`${x.line.heading}: ${x.line.monthCents.length} kuukautta`}
          />
        ) : null,
    },
    {
      key: "monthly",
      label: "Kuussa",
      kind: "money",
      main: true,
      cents: (x) => (x.line ? monthly[x.i]! : r.cardBills!.monthlyCents),
    },
    {
      key: "bar",
      label: "",
      kind: "text",
      className: () => "rt-bar-cell",
      bar: { value: (x) => (x.line ? (shares[x.i] ?? 0) : 0), max: 100 },
      cell: () => null,
    },
    {
      key: "share",
      label: "Osuus",
      kind: "share",
      cell: (x) =>
        !x.line ? (
          <span className="muted">–</span>
        ) : shares[x.i] == null ? (
          <span className="muted">ei osuutta</span>
        ) : (
          shareText(shares[x.i]!)
        ),
    },
    {
      key: "mean",
      label: "Ostoskerta",
      kind: "money",
      phone: "hide",
      // under six purchases a mean says nothing: the cell says there were too few
      cell: (x) =>
        !x.line ? (
          dash
        ) : x.line.meanCents === null ? (
          <span className="muted">liian vähän ostoja</span>
        ) : (
          money(x.line.meanCents, false)
        ),
    },
    {
      key: "perMonth",
      label: "Kertaa kuussa",
      kind: "count",
      phone: "hide",
      cell: (x) =>
        !x.line || x.line.perMonth === null ? dash : count(x.line.perMonth),
    },
    ...(change || usualOnly
      ? [
          {
            key: "change",
            label: "Muutos",
            kind: "money" as const,
            cell: (x: Row) =>
              x.line && x.line.changeCents !== null ? (
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
        Kuussa, ostoskerta ja kertaa kuussa ovat {r.window.months} kuukauden
        keskiarvoja ({span(r.window)}).
        {change || usualOnly
          ? " Muutos on kolmen viimeisen kuukauden keskiarvo kuuden niitä edeltävän kuukauden tavalliseen tasoon verrattuna."
          : ""}
      </p>
      <DataTable
        id="food-lines"
        caption="Ruokarivit"
        className="food-lines"
        rows={rows}
        rowKey={(x) => x.id}
        columns={cols}
        drill={(x) =>
          x.line && (x.line.payees.length > 0 || x.line.weekdays) ? (
            <LineDetail line={x.line} />
          ) : null
        }
        drillLabel={(x) => `Kauppiaat: ${x.line?.heading ?? ""}`}
        total={{
          label: "Yhteensä",
          cells: {
            monthly: <strong>{money(r.monthlyCents, false)}</strong>,
            bar: hasShares ? <BarCell value={100} max={100} /> : null,
            share: hasShares ? "100 %" : "",
          },
        }}
      />
    </>
  );
}

function Food({ ctx }: SectionProps) {
  const r = ctx.data.food!;
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
  return (
    <ReportPanel
      id={section.id}
      title={section.title}
      datum={`Ruoka ${money(r.monthlyCents, false)} kuussa`}
    >
      <QuestionChart
        id="ruoka-kauppa"
        question="Kasvoivatko ruokakaupan menot käyntien vai ostoskerran takia?"
        answer={basketAnswer(b)}
        table={<Lines r={r} />}
      >
        {both && (
          <div className="qc-pair">
            <Slope
              items={[
                {
                  key: "visits",
                  label: "Kertaa kuussa",
                  from: b.before.perMonth!,
                  to: b.now.perMonth!,
                  strong: true,
                  tone: "flat",
                },
              ]}
              fromLabel="Sitä ennen"
              toLabel="Viimeiset 3 kuukautta"
              format={(v) => `${count(v)} kertaa`}
              label="Ruokakaupan käynnit kuussa, ennen ja nyt"
              caption="Käyntejä kuussa"
              height={120}
              zero={false}
            />
            <Slope
              items={[
                {
                  key: "mean",
                  label: "Ostoskerta",
                  from: b.before.meanCents!,
                  to: b.now.meanCents!,
                  strong: true,
                  tone: b.now.meanCents! > b.before.meanCents! ? "bad" : "good",
                },
              ]}
              fromLabel="Sitä ennen"
              toLabel="Viimeiset 3 kuukautta"
              format={(v) => money(v, false)}
              label="Ruokakaupan ostoskerta keskimäärin, ennen ja nyt"
              caption="Ostoskerta keskimäärin"
              height={120}
              zero={false}
            />
          </div>
        )}
      </QuestionChart>
      <hr className="qc-rule" />
      <QuestionChart
        id="ruoka-lajit"
        question="Mihin ruokarahat menevät?"
        answer={
          top ? (
            <>
              Ruokaan meni <strong>{money(r.monthlyCents, false)}</strong>{" "}
              kuussa, eniten: {top.heading.toLowerCase()}{" "}
              {money(top.monthlyCents, false)} kuussa.
            </>
          ) : (
            "Jaksolla ei ole ruokamenoja."
          )
        }
        table={<Lines r={r} />}
      >
        <Lines r={r} />
      </QuestionChart>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "ruoka",
  title: "Ruoka",
  order: 35,
  page: "reports",
  tab: "menot",
  reports: ["food"],
  // under three months there is no window, and without food there is nothing to tell
  visible: (ctx) => ctx.data.food != null,
  Component: Food,
};
