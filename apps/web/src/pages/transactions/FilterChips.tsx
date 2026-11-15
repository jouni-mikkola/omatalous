/**
 * The filters of Tapahtumat as the address holds them (`Filters`), and the chips of the Kauppiaat tab, which has a
 * period and a category only. The list's own bar is `TxBar`. An unset chip offers its filter with a "+", a set one
 * names its value and has an x; "Tyhjennä" is there only while something is set.
 */
import { type ReactNode, useRef, useState } from "react";
import { navigate } from "../../hooks.ts";
import { t } from "../../text.ts";
import type { Category } from "../../types.ts";
import { CategoryIcon } from "./category-look.tsx";
import { CategoryMenu } from "./CategoryChip.tsx";
import { DateRange, type Period, periodLabel } from "./DateRange.tsx";
import { Popover } from "./Popover.tsx";

export interface Filters {
  q: string;
  /** The key of the mark (Käsin luokitellut, Varaukset) that narrows the shown rows; the table applies it. */
  chip: string;
  category: string;
  kind: string;
  accountId: string;
  merchant: string;
  from: string;
  to: string;
}

/** A filter chip: unset ("+ name") it opens its list, set (`value` not null) it names its value and has an x. */
function Chip({ name, value, icon, onClear, children }: { name: string; value: string | null; icon?: ReactNode; onClear: () => void; children?: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  return (
    <span className={`tx-fchip${value !== null ? " set" : ""}`}>
      <button ref={button} type="button" className="tx-fchip-main" aria-haspopup={children ? "dialog" : undefined} aria-expanded={children ? open : undefined} onClick={() => (children ? setOpen((v) => !v) : onClear())}>
        {value !== null ? (
          <>
            <span className="tx-fchip-name">{name}</span>
            {icon}
            {value && <span className="tx-fchip-value">{value}</span>}
          </>
        ) : (
          <>
            <span aria-hidden="true" className="tx-fchip-plus">
              +
            </span>
            {name}
          </>
        )}
      </button>
      {value !== null && (
        <button type="button" className="tx-fchip-x" aria-label={t("fchip.remove", { name })} onClick={onClear}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
          </svg>
        </button>
      )}
      {children && (
        <Popover open={open} onClose={close} anchor={button} label={name}>
          {children(close)}
        </Popover>
      )}
    </span>
  );
}

/**
 * The filters of the Kauppiaat tab, in the toolbar of its table beside the one search box: a period and a category.
 */
export function MerchantFilters({ filters, categories, today, set }: { filters: { category: string; from: string; to: string }; categories: Category[]; today: string; set: (patch: { category?: string; from?: string; to?: string }) => void }) {
  const period: Period = { from: filters.from, to: filters.to };
  const picked = categories.find((c) => c.id === filters.category);
  const any = !!(filters.category || filters.from || filters.to);
  return (
    <div className="tx-fchips" role="group" aria-label={t("fchip.filters")}>
      <Chip name={t("fchip.period")} value={filters.from || filters.to ? periodLabel(period, today) : null} onClear={() => set({ from: "", to: "" })}>
        {(close) => (
          <DateRange
            value={period}
            today={today}
            onCommit={(p) => {
              close();
              set(p);
            }}
          />
        )}
      </Chip>
      <Chip name={t("fchip.category")} value={picked?.label ?? (filters.category || null)} icon={picked && <CategoryIcon category={picked} />} onClear={() => set({ category: "" })}>
        {(close) => (
          <CategoryMenu
            categories={categories}
            value={filters.category}
            onPick={(id) => {
              close();
              set({ category: id });
            }}
          />
        )}
      </Chip>
      {any && (
        <button type="button" className="tx-fclear" onClick={() => navigate("transactions", { view: "merchants" })}>
          {t("tx.clear")}
        </button>
      )}
    </div>
  );
}
