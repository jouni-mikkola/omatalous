import { useState } from "react";
import { api } from "../api.ts";
import type { Category } from "../types.ts";
import { CategorySelect } from "./CategorySelect.tsx";

/**
 * A payee with no category of its own gets one here: the choice is saved at once as a rule for the payee
 * (`merchant_exact`), so its rows and the ones to come move. One save at a time, the failed one's sentence in `error`.
 * `onSaved` runs after a save, so the list the payee came from can be read again.
 */
export function usePayeeCategory(onSaved: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (merchant: string, category: string) => {
    if (!category || busy) return;
    setBusy(merchant);
    setError(null);
    try {
      await api("/api/rules", { method: "POST", body: { field: "merchant_exact", pattern: merchant, category } });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, save };
}

/**
 * The picker of a payee's category: nothing chosen, `Valitse kategoria` first. Money out may take any category but Muut
 * menot; money in only the income categories.
 */
export function PayeeCategorySelect({ categories, merchant, incomeOnly, disabled, onPick }: { categories: Category[]; merchant: string; incomeOnly?: boolean; disabled: boolean; onPick: (category: string) => void }) {
  return (
    <CategorySelect
      categories={categories.filter((c) => (incomeOnly ? c.kind === "income" : c.id !== "other"))}
      value=""
      allowEmpty
      emptyLabel="Valitse kategoria"
      ariaLabel={`Kategoria: ${merchant}`}
      disabled={disabled}
      onChange={onPick}
    />
  );
}
