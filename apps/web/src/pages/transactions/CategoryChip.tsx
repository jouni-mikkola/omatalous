/**
 * The category of a row as text on a chip in its group's colour. Changing it is the picker, a list of our own
 * with a search (no native select: a page of rows would carry thousands of options, and the system list shows no icons):
 * the row's menu and the category filter open the same one.
 */
import { fold } from "@banking/core";
import { useMemo, useState } from "react";
import { t } from "../../text.ts";
import type { Category } from "../../types.ts";
import { CategoryIcon, slotOf } from "./category-look.tsx";

export function CategoryMenu({ categories, value, onPick, note }: { categories: (Category & { groupName?: string })[]; value: string; onPick: (id: string) => void; note?: string }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => {
    const f = fold(q.trim());
    return f ? categories.filter((c) => fold(c.label).includes(f) || fold(c.group).includes(f) || fold(c.groupName ?? "").includes(f)) : categories;
  }, [categories, q]);
  const groups: { group: string; name: string; items: Category[] }[] = [];
  for (const c of shown) {
    const last = groups[groups.length - 1];
    if (last?.group === c.group) last.items.push(c);
    else groups.push({ group: c.group, name: c.groupName ?? c.group, items: [c] });
  }
  const move = (d: number) => setActive((i) => Math.min(Math.max(i + d, 0), shown.length - 1));
  return (
    <div className="tx-catmenu">
      <input
        type="search"
        className="tx-pop-search"
        autoFocus
        placeholder={t("tx.cat_search")}
        aria-label={t("tx.cat_search")}
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
      <div className="tx-catlist" id="tx-catlist" role="listbox" aria-label={t("tx.categories")}>
        {groups.map((g) => (
          <div key={g.group} role="group" aria-label={g.name}>
            <div className="tx-catgroup" aria-hidden="true">
              {g.name}
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
                {c.id === value && <span className="tx-catopt-now">{t("tx.now")}</span>}
              </div>
            ))}
          </div>
        ))}
        {!shown.length && <div className="tx-catnone">{t("tx.no_hits")}</div>}
      </div>
      {note && <p className="tx-pop-note">{note}</p>}
    </div>
  );
}

/** The chip's face: the category's name as text, no icon, and the quiet dot when the household set it. */
function Face({ label, manual }: { label: string; manual?: boolean }) {
  return (
    <>
      <span className="tx-chip-label">{label}</span>
      {/* the household set it: a quiet dot, the word for readers and the pointer */}
      {manual && (
        <span className="tx-chip-manual" title={t("tx.manual")}>
          <span className="sr-only">{t("tx.manual")}</span>
        </span>
      )}
    </>
  );
}

/** The category of a row told, not changed: the chip's face without the button (the row's open part has the picker). */
export function CategoryLabel({ categories, value, manual }: { categories: (Category & { groupName?: string })[]; value: string; manual?: boolean }) {
  const c = categories.find((x) => x.id === value);
  return (
    <span className="tx-chip" data-slot={slotOf(c)}>
      <Face label={c?.label ?? value} manual={manual} />
    </span>
  );
}

/** The category of a row on a shared account: told, with the reason it cannot be changed here. */
export function SharedCategory({ categories, value, manual }: { categories: (Category & { groupName?: string })[]; value: string; manual?: boolean }) {
  const c = categories.find((x) => x.id === value);
  return (
    <span className="tx-chip" data-slot={slotOf(c)} title={t("tx.shared_cat")}>
      <Face label={c?.label ?? value} manual={manual} />
    </span>
  );
}
