/**
 * The category of a row as a chip in its group's colour with its own icon; on an own row a tap opens the picker, a list
 * of our own with a search (no native select: a page of rows would carry thousands of options, and the system list
 * shows no icons). The filter bar uses the same list.
 */
import { fold } from "@banking/core";
import { memo, useMemo, useRef, useState } from "react";
import type { Category } from "../../types.ts";
import { CategoryIcon, slotOf } from "./category-look.tsx";
import { Popover } from "./Popover.tsx";

export function CategoryMenu({ categories, value, onPick, note }: { categories: Category[]; value: string; onPick: (id: string) => void; note?: string }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => {
    const f = fold(q.trim());
    return f ? categories.filter((c) => fold(c.label).includes(f) || fold(c.group).includes(f)) : categories;
  }, [categories, q]);
  const groups: { group: string; items: Category[] }[] = [];
  for (const c of shown) {
    const last = groups[groups.length - 1];
    if (last?.group === c.group) last.items.push(c);
    else groups.push({ group: c.group, items: [c] });
  }
  const move = (d: number) => setActive((i) => Math.min(Math.max(i + d, 0), shown.length - 1));
  return (
    <div className="tx-catmenu">
      <input
        type="search"
        className="tx-pop-search"
        placeholder="Hae kategoriaa"
        aria-label="Hae kategoriaa"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), move(1));
          else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
          else if (e.key === "Enter" && shown[active]) (e.preventDefault(), onPick(shown[active]!.id));
        }}
        role="combobox"
        aria-expanded="true"
        aria-controls="tx-catlist"
        aria-activedescendant={shown[active] ? `tx-cat-${shown[active]!.id}` : undefined}
      />
      <div className="tx-catlist" id="tx-catlist" role="listbox" aria-label="Kategoriat">
        {groups.map((g) => (
          <div key={g.group} role="group" aria-label={g.group}>
            <div className="tx-catgroup" aria-hidden="true">
              {g.group}
            </div>
            {g.items.map((c) => (
              <div
                key={c.id}
                id={`tx-cat-${c.id}`}
                role="option"
                tabIndex={-1}
                aria-selected={c.id === value}
                className={`tx-catopt${shown[active]?.id === c.id ? " on" : ""}`}
                data-slot={slotOf(c)}
                onPointerEnter={() => setActive(shown.indexOf(c))}
                onClick={() => onPick(c.id)}
              >
                <CategoryIcon category={c} />
                <span>{c.label}</span>
                {c.id === value && <span className="tx-catopt-now">nyt</span>}
              </div>
            ))}
          </div>
        ))}
        {!shown.length && <div className="tx-catnone">Ei osumia</div>}
      </div>
      {note && <p className="tx-pop-note">{note}</p>}
    </div>
  );
}

/** A chip for a category; `onPick` makes it a button that opens the picker. `pending` is the choice being saved. */
export const CategoryChip = memo(function CategoryChip({ categories, value, pending, merchant, note, manual, onPick }: { categories: Category[]; value: string; pending?: string | null; merchant: string; note?: string; manual?: boolean; onPick?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const shown = pending ?? value;
  const c = categories.find((x) => x.id === shown);
  const label = c?.label ?? shown;
  const face = (
    <>
      <CategoryIcon category={c} />
      <span className="tx-chip-label">{label}</span>
      {/* the household set it: a quiet dot, the word for readers and the pointer */}
      {manual && (
        <span className="tx-chip-manual" title="käsin">
          <span className="sr-only">käsin</span>
        </span>
      )}
    </>
  );
  if (!onPick) {
    return (
      <span className="tx-chip" data-slot={slotOf(c)} title="Jaettu tili. Vain omistaja voi muuttaa kategorian.">
        {face}
      </span>
    );
  }
  return (
    <span className="tx-chip-wrap">
      <button
        ref={button}
        type="button"
        className="tx-chip"
        data-slot={slotOf(c)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-disabled={pending ? true : undefined}
        aria-busy={pending ? true : undefined}
        aria-label={`Kategoria: ${merchant}, nyt ${label}`}
        onClick={() => !pending && setOpen((v) => !v)}
      >
        {face}
        <svg className="tx-chip-caret" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 4 5 6.5 7.5 4" />
        </svg>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={button} label={`Kategoria: ${merchant}`}>
        <CategoryMenu
          categories={categories}
          value={shown}
          note={note}
          onPick={(id) => {
            setOpen(false);
            button.current?.focus();
            if (id !== shown) onPick(id);
          }}
        />
      </Popover>
    </span>
  );
});
