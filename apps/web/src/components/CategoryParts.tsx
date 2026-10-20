// Decision: what a category's money bought, a level under it (the reports' category table and Yhteenveto's bar)
import type { CategoryPart } from "@banking/core";
import { money } from "../format.ts";
import { Estimate } from "./Why.tsx";
import "../styles/statement.css";
import "../styles/category-parts.css";

/**
 * The parts the server gives under a category, in its order, each its own figure: the web adds nothing up. A part whose
 * cents rest partly on a guessed tie wears "≈". The shared build sends no parts, and this draws nothing then.
 */
export function CategoryParts({
  parts,
  label,
}: {
  parts: readonly CategoryPart[] | undefined;
  label: string;
}) {
  if (!parts?.length) return null;
  return (
    <div className="cat-parts">
      <p className="cat-parts-head">Tuoteryhmittäin</p>
      <ul className="st-rows" aria-label={label}>
        {parts.map((p) => (
          <li className="st-row" key={p.id}>
            <span className="st-name" title={p.label}>
              {p.label}
            </span>
            <span className="st-num">
              <Estimate when={p.estimated}>{money(p.cents, false)}</Estimate>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
