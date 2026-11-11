import { type Ref } from "react";
import { t } from "../text.ts";
import type { Category } from "../types.ts";

/** Category picker grouped like the reports: Asuminen, Ruoka, … Velanhoito, Tulot, Siirrot. */
export function CategorySelect({
  categories,
  value,
  onChange,
  allowEmpty,
  emptyLabel = t("select.all_categories"),
  ariaLabel = t("select.category"),
  disabled,
  selectRef,
  onBlur,
}: {
  categories: (Category & { groupName?: string })[];
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
        <optgroup key={group} label={categories.find((c) => c.group === group)?.groupName ?? group}>
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
