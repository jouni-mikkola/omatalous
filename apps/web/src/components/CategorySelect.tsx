import { type Ref, useEffect, useRef, useState } from "react";
import type { Category } from "../types.ts";

/** Category picker grouped like the reports: Asuminen, Ruoka, … Velanhoito, Tulot, Siirrot. */
export function CategorySelect({
  categories,
  value,
  onChange,
  allowEmpty,
  emptyLabel = "Kaikki kategoriat",
  ariaLabel = "Kategoria",
  disabled,
  selectRef,
  onBlur,
}: {
  categories: Category[];
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
  selectRef?: Ref<HTMLSelectElement>;
  onBlur?: () => void;
}) {
  const groups = [...new Set(categories.map((c) => c.group))];
  return (
    <select ref={selectRef} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} aria-label={ariaLabel} disabled={disabled}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {categories
            .filter((c) => c.group === group)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * Looks like the select, but builds the option list only when opened. A page
 * with hundreds of rows would otherwise carry thousands of option elements.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  categories: Category[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const label = categories.find((c) => c.id === value)?.label ?? value;

  useEffect(() => {
    if (open) {
      select.current?.focus();
      try {
        select.current?.showPicker?.();
      } catch {
        // older browsers open the list on the next click or key press
      }
    } else if (refocus.current && !disabled) {
      // a disabled button (a save in flight) cannot take focus yet; this runs again when it is enabled
      refocus.current = false;
      button.current?.focus();
    }
  }, [open, disabled]);

  if (!open) {
    return (
      // aria-disabled keeps the button focusable while a save is running, so keyboard focus survives the reload
      <button ref={button} type="button" className="select-lite" aria-disabled={disabled || undefined} aria-label={`${ariaLabel}, nyt ${label}`} onClick={() => !disabled && setOpen(true)}>
        <span>{label}</span>
      </button>
    );
  }
  return (
    <span onKeyDown={(e) => {
      if (e.key === "Escape") {
        refocus.current = true;
        setOpen(false);
      }
    }}>
      <CategorySelect
        categories={categories}
        value={value}
        ariaLabel={ariaLabel}
        selectRef={select}
        onBlur={() => setOpen(false)}
        onChange={(next) => {
          // keyboard users stay where they were
          refocus.current = true;
          setOpen(false);
          if (next !== value) onChange(next);
        }}
      />
    </span>
  );
}
