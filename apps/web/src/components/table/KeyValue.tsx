/**
 * Decision: read what one thing is (the facts of one connection, one plan), where a table would compare rows.
 *
 * A list of facts about one subject: the name at the left, the value at the right, a hairline between. A subject with one
 * row is a sentence and a list with several things to compare is a Table, so this holds the case between: one thing,
 * several facts. The page's heading names it.
 */
import type { ReactNode } from "react";
import "../../styles/table.css";

/** A fact is its name, its value and, when the page marks it, a class. */
export type Fact = readonly [name: string, value: ReactNode, className?: string];

export function KeyValue({ items, className }: { items: readonly Fact[]; className?: string }) {
  return (
    <dl className={className ? `rt-kv ${className}` : "rt-kv"}>
      {items.map(([name, value, mark], i) => (
        <div key={`${i}:${name}`} className={mark}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
