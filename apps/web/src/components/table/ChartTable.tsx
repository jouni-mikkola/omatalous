/**
 * Decision: the same figures as the chart, read as numbers (the chart's accessible form).
 *
 * The table view of a series chart: the x labels (months) first, one money column per series with its unit in the head,
 * and a caption that names the chart's question. Each chart passes its own rows; no figure is made here.
 */
import { createContext, useContext } from "react";
import { Table } from "./Table.tsx";

/** The question of the chart whose table is shown (QuestionChart sets it), so the caption names the chart. */
export const ChartQuestion = createContext<string | null>(null);

export type ChartSeries = { key: string; label: string };
export type ChartRow = {
  key: string;
  label: string;
  values: (number | null)[];
};

export function ChartTable({
  xLabel,
  series,
  rows,
  unit = "€",
  precision = "euros",
}: {
  xLabel: string;
  series: ChartSeries[];
  rows: ChartRow[];
  unit?: string;
  precision?: "cents" | "euros";
}) {
  const question = useContext(ChartQuestion);
  return (
    <Table
      caption={question ? `${question} taulukkona` : `${xLabel}, taulukkona`}
      rows={rows}
      rowKey={(r) => r.key}
      columns={[
        {
          key: "x",
          label: xLabel,
          kind: "text",
          rowHead: true,
          cell: (r) => r.label,
        },
        ...series.map((s, i) => ({
          key: s.key,
          label: `${s.label} (${unit})`,
          kind: "money" as const,
          precision,
          cents: (r: ChartRow) => r.values[i] ?? null,
        })),
      ]}
    />
  );
}
