import { type ReactNode, useState } from "react";
import { cx } from "./cx.ts";

/**
 * A card that is folded while there is nothing to do in it (a feature that is off, a list with no rows) and open when
 * there is. One element either way, so a form keeps what was typed when the answer changes the default; a click on the
 * heading is the reader's choice and wins over it. The name and the state stay in view when it is folded.
 */
export function FoldCard({ id, className, title, sub, folded, children }: { id?: string; className?: string; title: ReactNode; sub?: ReactNode; folded: boolean; children: ReactNode }) {
  const [opened, setOpened] = useState<boolean | null>(null);
  const open = opened ?? !folded;
  // the click is the reader's choice; the toggle event also fires when the default changes the attribute, so it is not read
  return (
    <details className={cx("card", className)} id={id} open={open}>
      <summary
        className="card-head"
        onClick={(e) => {
          e.preventDefault();
          // the element's own state, which find-in-page can change without React
          setOpened(!(e.currentTarget.parentElement as HTMLDetailsElement).open);
        }}
      >
        <div>
          <h2>{title}</h2>
          {sub !== undefined && <div className="card-sub">{sub}</div>}
        </div>
      </summary>
      {children}
    </details>
  );
}
