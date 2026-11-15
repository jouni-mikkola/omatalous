import type { ReactNode } from "react";
import { Section } from "../../components/Section.tsx";
import { ChartQuestion } from "../../components/table/ChartTable.tsx";
import { ChartWithTable } from "../../components/table/selection.tsx";
import { crisp } from "../draw.ts";
import type { Linear } from "../kit/scale.ts";
import { boxPlace } from "../kit/readout.ts";
import "../../styles/question-chart.css";
import { css } from "../../css.ts";

/** A panel of Raportit: its name, the summary figure in the head (the datum), then the CSV link or other actions. */
export function ReportPanel({ id, title, datum, actions, children }: { id: string; title: string; datum?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Section id={id} title={title} datum={datum} actions={actions}>
      {children}
    </Section>
  );
}

/**
 * One chart under its question (ILME 4, rule 1): the title asks what the household asks and the line under it answers
 * with the figure. A chart's rows stand under it as a table (ADR 0018) unless another table of the page carries them; pointing at a mark of the chart reads
 * it out, and a click on it keeps only that mark's row in the table. A part that is a table already has no `table`.
 */
export function QuestionChart({ id, question, answer, table, children, wide }: { id: string; question: string; answer: ReactNode; table?: ReactNode; children?: ReactNode; wide?: boolean }) {
  return (
    <figure className={wide ? "qc qc-wide" : "qc"} aria-labelledby={`${id}-q`}>
      <figcaption className="qc-head">
        <div className="qc-text">
          <h3 id={`${id}-q`} className="qc-q">
            {question}
          </h3>
          <p className="qc-a">{answer}</p>
        </div>
      </figcaption>
      <ChartWithTable chart={children} table={table ? <ChartQuestion.Provider value={question}>{table}</ChartQuestion.Provider> : undefined} />
    </figure>
  );
}

/** The value axis of a plot: a recessive grid line and a label per tick, the zero line drawn as the axis. */
export function ValueGrid({ y, innerW, format }: { y: Linear; innerW: number; format: (v: number) => string }) {
  return (
    <g>
      {y.ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? "axis-line" : "grid-line"} x1={0} x2={innerW} y1={crisp(y(t))} y2={crisp(y(t))} />
          <text x={-8} y={y(t)} dy="0.32em" textAnchor="end">
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** The readout box beside the datum at `x` (plot pixels), inside the chart's own width. */
export function Tip({ x, left, width, title, rows }: { x: number; left: number; width: number; title: string; rows: { name: string; value: string; key?: ReactNode }[] }) {
  const place = boxPlace(x + left, width);
  return (
    <div className="tooltip" ref={css({ left: undefined, right: undefined, ...place, top: 8 })} role="presentation">
      <div className="tooltip-title">{title}</div>
      {rows.map((r) => (
        <div className="tooltip-row" key={r.name}>
          <span className="name">
            {r.key}
            {r.name}
          </span>
          <strong>{r.value}</strong>
        </div>
      ))}
    </div>
  );
}

/** Two end labels on the right of a plot, nudged apart so neither covers the other. */
export function spreadLabels<T extends { y: number }>(labels: T[], gap: number, innerH: number): T[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    if (sorted[i]!.y - prev.y < gap) sorted[i] = { ...sorted[i]!, y: prev.y + gap };
  }
  // the lowest may now hang under the plot: push the stack back up
  const over = sorted.length ? sorted[sorted.length - 1]!.y - innerH : 0;
  return over > 0 ? sorted.map((l) => ({ ...l, y: l.y - over })) : sorted;
}
