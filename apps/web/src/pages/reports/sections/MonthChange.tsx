// Decision: which categories made a month dearer or cheaper than the usual one, and by how much each
import { useState } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { SpanCell } from "../../../components/table/Cells.tsx";
import { spanAxis } from "../../../components/table/cells.ts";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { money, monthLong, signedMoney } from "../../../format.ts";
import type { ReportsData } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";
import "../../../styles/report-spending.css";

type Change = NonNullable<ReportsData["spendingMonths"]["changes"][number]>;
type Bar = { key: string; label: string; from: number | null; to: number; cents: number; tone: "rise" | "fall" | "usual" | "whole"; figure: string };

const eur = (cents: number) => money(cents, false);
// the month stands at the start of a row
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The usual month, a step for each category that moved it and the month, as rows of a table with a bar that starts where
 * the step before it ended. Every figure and every start is the server's (`changes` of the spending report): the rows only
 * name them.
 */
function barsOf(change: Change, month: string): Bar[] {
  return [
    { key: "usual", label: t("rpt.mc_levels"), from: null, to: change.startCents, cents: change.startCents, tone: "usual", figure: eur(change.startCents) },
    ...change.steps.map((s) => ({
      key: s.category ?? (s.withoutLevel ? "without-level" : "rest"),
      label: s.label ?? t(s.withoutLevel ? "rpt.mc_without_level" : "rep.rest_changes"),
      from: s.fromCents,
      to: s.toCents,
      cents: s.cents,
      tone: s.cents < 0 ? ("fall" as const) : ("rise" as const),
      figure: signedMoney(s.cents),
    })),
    { key: "month", label: capital(monthLong(month)), from: null, to: change.endCents, cents: change.endCents, tone: "whole", figure: eur(change.endCents) },
  ];
}

function MonthChange({ ctx }: SectionProps) {
  const r = ctx.data.spendingMonths;
  // the months the categories can be set against their level; the newest complete one stands first
  const pickable = r.changes.flatMap((c, i) => (c ? [i] : []));
  const [picked, setPicked] = useState<number | null>(null);
  const at = picked !== null && pickable.includes(picked) ? picked : (pickable.at(-1) ?? 0);
  const change = r.changes[at]!;
  const month = r.months[at]!;
  const bars = barsOf(change, month);
  const axis = spanAxis(bars.flatMap((b) => (b.from === null ? [b.to] : [b.from, b.to])));
  const place = pickable.indexOf(at);
  const before = place > 0 ? pickable[place - 1]! : null;
  const after = place < pickable.length - 1 ? pickable[place + 1]! : null;
  const columns: Column<Bar>[] = [
    { key: "label", label: t("rpt.sm_category"), kind: "text", rowHead: true, headHidden: true, cell: (b) => b.label, csv: false },
    { key: "bar", label: t("rpt.mc_step"), kind: "text", headHidden: true, csv: false, cell: (b) => <SpanCell from={b.from} to={b.to} axis={axis} tone={b.tone} /> },
    { key: "figure", label: t("rpt.sum"), kind: "money", main: true, cents: (b) => b.cents, cell: (b) => b.figure, csv: false },
  ];
  return (
    <ReportPanel id={section.id} title={section.title}>
      <div className="mc-pick">
        {before !== null && <Button variant="link" onClick={() => setPicked(before)}>{t("rpt.mc_prev", { month: monthLong(r.months[before]!) })}</Button>}
        <strong>{monthLong(month)}</strong>
        {after !== null && <Button variant="link" onClick={() => setPicked(after)}>{t("rpt.mc_next", { month: monthLong(r.months[after]!) })}</Button>}
      </div>
      <Table<Bar> caption={t("rpt.mc_caption", { month: monthLong(month) })} rows={bars} rowKey={(b) => b.key} columns={columns} toolbar={false} csv={false} search={false} rowClassName={(b) => (b.tone === "usual" || b.tone === "whole" ? "mc-whole" : undefined)} />
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "mika-muuttui",
  get title() {
    return t("rpt.sec_month_change");
  },
  order: 25,
  page: "reports",
  reports: ["spendingMonths"],
  // the categories have a level only with enough complete months, and a month to set against it
  visible: (ctx) => ctx.data.spendingMonths?.changes.some((c) => c !== null) ?? false,
  open: true,
  Component: MonthChange,
};
