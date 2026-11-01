import { type Insight, insightText } from "../src/index.ts";

/** An insight as the tests read it: its sentences from `explain/insights.ts` beside the data. */
export interface InsightView {
  id: string;
  title: string;
  detail: string;
  tone: "good" | "warning" | "info";
  /** The year's effect without its sign. */
  yearlyCents: number;
  /** For a change of spending: 1 up, −1 down. */
  direction?: 1 | -1;
  rows: string[];
  link: Insight["evidence"]["link"];
  merchant: string | undefined;
  calc: Insight["evidence"]["calc"];
  insight: Insight;
}

const CHANGES: ReadonlySet<string> = new Set(["spending-growth", "groceries", "small-purchases", "season", "payday", "weekday"]);

export function view(insight: Insight): InsightView {
  const text = insightText(insight);
  const cents = insight.effectPerYear?.cents ?? 0;
  return {
    id: insight.id,
    title: text.title,
    detail: text.detail,
    tone: text.tone,
    yearlyCents: Math.abs(cents),
    ...(CHANGES.has(insight.fact.type) ? { direction: cents < 0 ? (1 as const) : (-1 as const) } : {}),
    rows: insight.evidence.rows,
    link: insight.evidence.link,
    merchant: insight.evidence.merchant,
    calc: insight.evidence.calc,
    insight,
  };
}

/** The year's effect of an insight without its sign. */
export const yearly = (i: Pick<Insight, "effectPerYear">) => Math.abs(i.effectPerYear?.cents ?? 0);

/** The part of an insight the overlap rule reads, for a test that has no insight at hand. */
export function covering(rows: string[], yearlyCents: number): Pick<Insight, "evidence" | "effectPerYear"> {
  return { evidence: { rows, calc: [] }, effectPerYear: { label: "Vaikutus vuodessa", value: "", cents: -yearlyCents } };
}
