/**
 * The contract of a feature module: what a folder under `features/<kind>/<id>/` exports as `module`, and what the
 * frame of its kind hands it. A module imports this file, `kit/` and its own folder, nothing else (the import
 * boundaries in tools/repo-rules/boundaries.ts), so the types a module needs are re-exported here.
 *
 * The registry of each kind (`features/<kind>/registry.gen.ts`) is written by `pnpm gen`, one line a module, and read
 * whole with `import * as all`. Nothing lists a feature by hand.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import type { Insight } from "../analysis/insights/types.ts";
import type { DateRange } from "../analysis/period.ts";
import type { AreaInput, AreaResult } from "../optimise/types.ts";
import type { BalanceInput, IsoDate, UserInputs } from "../types.ts";
import type * as sectionRegistry from "./section/registry.gen.ts";

export type { AnalysisContext, AreaInput, AreaResult, BalanceInput, DateRange, Insight, IsoDate, UserInputs };

export type FeatureKind = "insight" | "check" | "section" | "payee" | "question" | "notice";
/** What an answer depends on beside the context. The server builds the cache key from it. */
export type Reads = "range" | "balances" | "inputs" | "answers";

/** The household's answers to the questions it was asked. Placeholder until the answers store gives it its shape. */
export type Answers = Readonly<Record<string, unknown>>;
/** A row a payee module looks at. Placeholder until the first payee module gives it its fields. */
export interface PayeeRow {
  readonly text: string;
}
/** What a payee module knows about a payee. Placeholder as above. */
export interface PayeeFact {
  readonly id: string;
}
/** A question the household is asked. Placeholder until the first question module gives it its fields. */
export interface Question {
  readonly id: string;
}
/** A notice shown to the household. Placeholder until the first notice module gives it its fields. */
export interface Notice {
  readonly id: string;
}

interface ModuleBase<K extends FeatureKind> {
  kind: K;
  /** The folder's name. In addresses, marks and golden files, so it never changes. */
  id: string;
  /** Place among its kind where the frame keeps a tie. Gaps of 10. */
  order: number;
  reads: readonly Reads[];
  /** Other modules whose answer this one reads, by id. Never an import of their files. */
  uses?: readonly string[];
}

export interface FeatureInput {
  ctx: AnalysisContext;
  range: DateRange;
  end: IsoDate;
  running: boolean;
  balances: readonly BalanceInput[];
  inputs: UserInputs;
  answers: Answers;
  /** The answer of a module named in `uses`, computed once. */
  use<T>(id: string): T;
}

export interface InsightModule extends ModuleBase<"insight"> {
  find(input: FeatureInput): Insight[];
}
export interface CheckModule extends ModuleBase<"check"> {
  label: string;
  assess(input: AreaInput): AreaResult;
}
export interface SectionModule<T = unknown> extends ModuleBase<"section"> {
  /** What the household decides with the section (the `Decision:` of the reports). */
  decision: string;
  build(input: FeatureInput): T;
}
export interface PayeeModule extends ModuleBase<"payee"> {
  match(row: PayeeRow): PayeeFact | null;
}
export interface QuestionModule<A = unknown> extends ModuleBase<"question"> {
  ask(input: FeatureInput): Question[];
  /** Null refuses what the browser sent. The one route validates with it. */
  parse(raw: unknown): A | null;
}
export interface NoticeModule extends ModuleBase<"notice"> {
  tell(input: FeatureInput): Notice[];
}
export type FeatureModule = InsightModule | CheckModule | SectionModule | PayeeModule | QuestionModule | NoticeModule;

/** The one way to write a module: `export const module = define({ kind: "insight", id: "...", ... })`. The `const` keeps the literal `id` and `kind`. */
export const define = <const M extends FeatureModule>(m: M): M => m;

/** What the section `Id` of the registry `R` builds. `never` for an id the registry does not have. */
export type SectionDataIn<R, Id extends string> = ReturnType<Extract<R[keyof R], { kind: "section"; id: Id; build: (input: never) => unknown }>["build"]>;
/** The answer of one section, by id, read from the generated registry: no export line a feature. */
export type SectionData<Id extends string> = SectionDataIn<typeof sectionRegistry, Id>;
