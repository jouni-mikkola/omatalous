/**
 * What every behaviour signal says it knows (owner's principle P2): a value, how sure the app is of it, and the rows it
 * stands on. `known` is read off rows with no inference (a count, a sum). `estimated` rests on a rule that can be wrong
 * on a real household (a series, a window, a link between two rows), and is told plainly, never in the warning style.
 * `guess` is only ever asked as a question, never told as a fact. BA1-behaviour-model.md has the rules per signal.
 */
export type Confidence = "known" | "estimated" | "guess";

export interface Fact<T> {
  value: T;
  confidence: Confidence;
  /** The ids of the rows the value stands on, oldest first. */
  evidence: readonly string[];
}
