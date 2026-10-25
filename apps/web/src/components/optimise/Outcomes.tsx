/**
 * Decision: whether a change the household made did what the tip said, so it keeps it, undoes it or looks again.
 * One row per done decision: the level a month before and after, the difference and the verdict, and the months as
 * bars with the changeover month left out. Every figure is the core's (`FindingOutcome` and its `detail`); the web
 * prints the difference with its sign and draws the bars.
 */
import { type FindingOutcome, type FindingState, type OptimiseData, type OutcomeDetail, parseFindingId } from "@banking/core";
import { date, money } from "../../format.ts";
import { DeltaChip, MarkCell } from "../table/Cells.tsx";
import { type Column, Table } from "../table/Table.tsx";
import { AreaMark, VerdictMark } from "./marks.tsx";
import { nameOf, subjectName } from "./shared.tsx";

/** The months before and after as bars on one scale, the two levels dashed, the changeover month a gap. */
function BeforeAfter({ detail }: { detail: OutcomeDetail }) {
  const { sums, changeMonth, before, after } = detail;
  if (sums.length < 3) return null;
  const W = 132;
  const H = 32;
  const n = sums.length + 1;
  const step = W / n;
  const top = Math.max(1, ...sums.map((s) => s.cents), before.cents, after.cents);
  const y = (c: number) => H - 1 - (Math.max(0, c) / top) * (H - 4);
  const cut = sums.findIndex((s) => s.month > changeMonth);
  const split = cut < 0 ? sums.length : cut;
  const xOf = (i: number) => (i >= split ? i + 1 : i) * step;
  return (
    <svg className="ba" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false">
      {sums.map((s, i) => (
        <rect key={s.month} className={i >= split ? "ba-after" : "ba-before"} x={xOf(i) + 1} y={y(s.cents)} width={Math.max(2, step - 2)} height={Math.max(1, H - 1 - y(s.cents))} rx="1" />
      ))}
      <line className="ba-change" x1={split * step + step / 2} x2={split * step + step / 2} y1="0" y2={H} />
      <line className="ba-level" x1="0" x2={split * step} y1={y(before.cents)} y2={y(before.cents)} />
      <line className="ba-level" x1={(split + 1) * step} x2={W} y1={y(after.cents)} y2={y(after.cents)} />
    </svg>
  );
}

function Who({ state, data }: { state: FindingState; data: OptimiseData }) {
  const parts = parseFindingId(state.findingId);
  const merchant = parts?.subject ? subjectName(parts.subject) : null;
  const named = merchant !== null && merchant !== parts?.subject;
  const text = (
    <span className="rt-who-text">
      <span>{nameOf(state.findingId, data.areas)}</span>
      <span className="sub">Tehty {date(state.effectiveDate ?? state.decidedAt)}</span>
    </span>
  );
  return named ? (
    <MarkCell name={merchant}>{text}</MarkCell>
  ) : (
    <span className="rt-who">
      {parts && <AreaMark id={parts.area} />}
      {text}
    </span>
  );
}

const perMonth = (m: { cents: number; months: number } | undefined) =>
  m ? (
    <>
      {money(m.cents)}
      <span className="sub">yleensä, {m.months} kuukautta</span>
    </>
  ) : (
    <span className="muted">–</span>
  );

/** "−12,40 €": the change in spending a month, its sign written. */
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : "±"}${money(Math.abs(cents))}`;

export function Outcomes({ data, outcomes }: { data: OptimiseData; outcomes: ReadonlyMap<string, FindingOutcome> }) {
  const rows = data.done.flatMap((d) => {
    const o = outcomes.get(d.state.findingId);
    return o ? [{ ...d, outcome: o }] : [];
  });
  if (!rows.length) return null;
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "change", label: "Muutos", kind: "text", rowHead: true, cell: (r) => <Who state={r.state} data={data} /> },
    { key: "before", label: "Ennen, kuussa", kind: "money", cell: (r) => perMonth(r.outcome.detail?.before) },
    { key: "after", label: "Jälkeen, kuussa", kind: "money", cell: (r) => perMonth(r.outcome.detail?.after) },
    {
      key: "diff",
      label: "Ero kuussa",
      kind: "money",
      main: true,
      // the saving a month is spending that fell: the chip shows the spending's change, so a saving reads as down and good
      cell: (r) => (r.outcome.monthlyCents !== null ? <DeltaChip delta={-r.outcome.monthlyCents} text={signed(-r.outcome.monthlyCents)} meaning="spend" flat={99} /> : <span className="muted">–</span>),
    },
    { key: "months", label: "Kuukaudet", kind: "text", className: () => "ba-cell", cell: (r) => r.outcome.detail && <BeforeAfter detail={r.outcome.detail} /> },
    {
      key: "result",
      label: "Tulos",
      kind: "text",
      cell: (r) => (
        <>
          <VerdictMark verdict={r.outcome.verdict} />
          <span className="sub outcome-reason">{r.outcome.reason}</span>
        </>
      ),
    },
  ];
  return (
    <>
      <Table<Row> caption="Tehtyjen muutosten tulokset" className="outcomes" rows={rows} rowKey={(r) => r.state.findingId} columns={columns} />
      <p className="small muted outcomes-key">
        <span className="ba-key ba-key-before" aria-hidden="true" /> ennen <span className="ba-key ba-key-after" aria-hidden="true" /> jälkeen, muutoksen kuukausi ei ole mukana. Katkoviiva on tavallinen taso.
      </p>
    </>
  );
}
