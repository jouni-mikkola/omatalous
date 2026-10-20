// A figure that opens its basis on tap, and the sheet it opens. The rule in one sentence, how the figure
// is known and the rows behind it, which the caller fetches only once the sheet is open. The figure is Why's BasisDoor:
// nothing at rest, an accent underline under the pointer or focus; an estimate alone has "≈".
import { type ReactNode, useCallback, useId, useState } from "react";
import { Figure } from "./Figure.tsx";
import { BasisDoor } from "./Why.tsx";
import "../styles/basis.css";
import "../styles/why.css";

/** One sheet open at a time in a view: the id of the open one, and a toggle. */
export function useSheet(): [string | null, (id: string) => void] {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = useCallback((id: string) => setOpen((o) => (o === id ? null : id)), []);
  return [open, toggle];
}

/** The figure as a button: `text` is what `money()` gives, drawn by `Figure` unless `children` draw it (a count-up). */
export function BasisFig({ text, estimated, open, onToggle, sheet, size = "s", label, children }: { text: string; estimated: boolean; open: boolean; onToggle: () => void; sheet: string; size?: "s" | "m" | "l"; label?: string; children?: ReactNode }) {
  return (
    <BasisDoor label={label} text={text} estimate={estimated} open={open} onToggle={onToggle} controls={sheet} className={`why-fig basis-fig basis-fig-${size}`}>
      {children ?? <Figure text={text} size={size} />}
    </BasisDoor>
  );
}

/** The sheet under a figure. `basis` is the word for how the figure is known; `children` are its rows. */
export function BasisSheet({ id, open, title, rule, basis, note, onClose, children }: { id: string; open: boolean; title: string; rule: string; basis: string; note?: string | null; onClose: () => void; children?: ReactNode }) {
  const heading = useId();
  if (!open) return null;
  return (
    <div className="basis-sheet" id={id} role="region" aria-labelledby={heading}>
      <div className="basis-head">
        <h3 id={heading}>{title}</h3>
        <button type="button" className="basis-close" aria-label="Sulje" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="basis-rule">{rule}</p>
      <p className="basis-kind">{basis}</p>
      {note && <p className="basis-note">{note}</p>}
      {children}
    </div>
  );
}
