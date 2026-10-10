import { Merchants } from "./Merchants.tsx";
import { Rules } from "./Rules.tsx";
import type { Meta } from "../types.ts";

export type CategoriesTab = "merchants" | "rules";

export function Categories({ meta, tab, onTab }: { meta: Meta; tab: CategoriesTab; onTab: (tab: CategoriesTab) => void }) {
  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="Kategoriat">
        <button type="button" aria-pressed={tab === "merchants"} onClick={() => onTab("merchants")}>
          Kauppiaat
        </button>
        <button type="button" aria-pressed={tab === "rules"} onClick={() => onTab("rules")}>
          Säännöt
        </button>
      </div>
      {tab === "merchants" ? <Merchants meta={meta} /> : <Rules meta={meta} />}
    </div>
  );
}
