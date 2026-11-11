/**
 * The filters the server applies to Tapahtumat, a chip per filter, for the table's toolbar (`toolbarExtra`; the search
 * box and the row chips are the toolbar's own). An unset chip offers its filter with a "+", a set one names its value
 * and has an x; "Tyhjennä" is there only while something is set. The address holds the filters, so a filtered list can
 * be linked and the back button undoes a filter.
 */
import { type ReactNode, useRef, useState } from "react";
import { navigate } from "../../hooks.ts";
import { t } from "../../text.ts";
import type { Category } from "../../types.ts";
import { AccountMark, type AccountLook } from "./Marks.tsx";
import { CategoryIcon } from "./category-look.tsx";
import { CategoryMenu } from "./CategoryChip.tsx";
import { DateRange, type Period, periodLabel } from "./DateRange.tsx";
import { Popover } from "./Popover.tsx";

export interface Filters {
  q: string;
  /** The key of the toolbar chip that narrows the shown rows; the table applies it. */
  chip: string;
  category: string;
  kind: string;
  accountId: string;
  merchant: string;
  from: string;
  to: string;
}

/** A filter chip: unset ("+ name") it opens its list, set (`value` not null) it names its value and has an x; a chip with no list is a toggle. */
export function Chip({ name, value, icon, onClear, children }: { name: string; value: string | null; icon?: ReactNode; onClear: () => void; children?: (close: () => void) => ReactNode }) {
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

export function FilterChips({ filters, categories, accounts, severalAccounts, looks, today, set, clear }: { filters: Filters; categories: Category[]; accounts: { id: string; name: string }[]; severalAccounts: boolean; looks: Map<string, AccountLook>; today: string; set: (patch: Partial<Filters>) => void; clear: () => void }) {
  const any = Object.values(filters).some(Boolean);
  const period: Period = { from: filters.from, to: filters.to };
  const picked = categories.find((c) => c.id === filters.category);
  const category = picked?.label ?? (filters.category || null);
  const account = filters.accountId ? (looks.get(filters.accountId)?.name ?? filters.accountId) : null;
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
      <Chip name={t("fchip.category")} value={category} icon={picked && <CategoryIcon category={picked} />} onClear={() => set({ category: "" })}>
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
      {filters.accountId && <Chip name={t("fchip.account")} value={account} onClear={() => set({ accountId: "" })} />}
      {filters.kind && <Chip name={t("fchip.income")} value="" onClear={() => set({ kind: "" })} />}
      {/* the rarer filters sit in one chip, so the row stays a period and a category */}
      {(!filters.kind || (severalAccounts && !filters.accountId)) && (
        <Chip name={t("fchip.more")} value={null} onClear={() => undefined}>
          {(close) => (
            <ul
              className="tx-acctlist"
              role="listbox"
              aria-label={t("fchip.more")}
              onKeyDown={(e) => {
                const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
                if (!keys.includes(e.key)) return;
                const options = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=option]")];
                if (!options.length) return;
                e.preventDefault();
                const at = options.indexOf(document.activeElement as HTMLElement);
                const next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : e.key === "ArrowDown" ? Math.min(at + 1, options.length - 1) : Math.max(at - 1, 0);
                options[next]?.focus();
              }}
            >
              {!filters.kind && (
                <li
                  role="option"
                  tabIndex={-1}
                  aria-selected={false}
                  onClick={() => {
                    close();
                    set({ kind: "income" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    close();
                    set({ kind: "income" });
                  }}
                >
                  <span className="tx-acctlist-name">{t("fchip.income_only")}</span>
                </li>
              )}
              {severalAccounts &&
                !filters.accountId &&
                accounts.map((a) => (
                  <li
                    key={a.id}
                    role="option"
                    tabIndex={-1}
                    aria-selected={false}
                    onClick={() => {
                      close();
                      set({ accountId: a.id });
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      close();
                      set({ accountId: a.id });
                    }}
                  >
                    <AccountMark look={looks.get(a.id)} fallback={a.name} />
                    <span className="tx-acctlist-name">{looks.get(a.id)?.name ?? a.name}</span>
                  </li>
                ))}
            </ul>
          )}
        </Chip>
      )}
      {filters.merchant && <Chip name={t("fchip.merchant")} value={filters.merchant} onClear={() => set({ merchant: "" })} />}
      {any && (
        <button type="button" className="tx-fclear" onClick={clear}>
          {t("tx.clear")}
        </button>
      )}
    </div>
  );
}

/**
 * The filters of the Kauppiaat tab, in the toolbar of its table beside the one search box: a period, a category and the
 * everyday-purchases filter that only the address sets. The same chips as the list's.
 */
export function MerchantFilters({ filters, categories, today, set }: { filters: { category: string; from: string; to: string; habit: boolean }; categories: Category[]; today: string; set: (patch: { category?: string; from?: string; to?: string; habit?: boolean }) => void }) {
  const period: Period = { from: filters.from, to: filters.to };
  const picked = categories.find((c) => c.id === filters.category);
  const any = !!(filters.category || filters.from || filters.to || filters.habit);
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
      {filters.habit && <Chip name={t("opt.hab_chk")} value="" onClear={() => set({ habit: false })} />}
      {any && (
        <button type="button" className="tx-fclear" onClick={() => navigate("transactions", { view: "merchants" })}>
          {t("tx.clear")}
        </button>
      )}
    </div>
  );
}
