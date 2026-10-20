/**
 * The filters of Tapahtumat in one bar: the search, then a chip per filter. An unset chip offers its filter with a
 * "+", a set one names its value and has an x; "Tyhjennä" is there only while something is set. The address holds
 * the filters, so a filtered list can be linked and the back button undoes a filter.
 */
import { type ReactNode, useRef, useState } from "react";
import { SearchBox } from "../../components/FilterInputs.tsx";
import type { Category } from "../../types.ts";
import { AccountMark, type AccountLook } from "./Marks.tsx";
import { CategoryIcon } from "./category-look.tsx";
import { CategoryMenu } from "./CategoryChip.tsx";
import { DateRange, type Period, periodLabel } from "./DateRange.tsx";
import { Popover } from "./Popover.tsx";

export interface Filters {
  q: string;
  category: string;
  kind: string;
  accountId: string;
  merchant: string;
  from: string;
  to: string;
}

/** A filter chip: unset ("+ name") it opens its list, set (`value` not null) it names its value and has an x; a chip with no list is a toggle. */
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
        <button type="button" className="tx-fchip-x" aria-label={`Poista rajaus: ${name}`} onClick={onClear}>
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

export function FilterBar({ filters, categories, accounts, looks, today, set, clear }: { filters: Filters; categories: Category[]; accounts: { id: string; name: string }[]; looks: Map<string, AccountLook>; today: string; set: (patch: Partial<Filters>) => void; clear: () => void }) {
  const any = Object.values(filters).some(Boolean);
  const period: Period = { from: filters.from, to: filters.to };
  const picked = categories.find((c) => c.id === filters.category);
  const category = picked?.label ?? (filters.category || null);
  const account = filters.accountId ? (looks.get(filters.accountId)?.name ?? filters.accountId) : null;
  return (
    <div className="tx-filterbar" role="search">
      <SearchBox value={filters.q} onSearch={(q) => set({ q })} label="Hae kauppiasta tai viestiä" />
      <div className="tx-fchips">
        <Chip name="Aikaväli" value={filters.from || filters.to ? periodLabel(period, today) : null} onClear={() => set({ from: "", to: "" })}>
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
        <Chip name="Kategoria" value={category} icon={picked && <CategoryIcon category={picked} />} onClear={() => set({ category: "" })}>
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
        <Chip name="Tili" value={account} onClear={() => set({ accountId: "" })}>
          {(close) => (
            <ul className="tx-acctlist" role="listbox" aria-label="Tilit">
              {accounts.map((a) => (
                <li
                  key={a.id}
                  role="option"
                  tabIndex={-1}
                  aria-selected={a.id === filters.accountId}
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
        <Chip name="Tulot" value={filters.kind ? "" : null} onClear={() => set({ kind: filters.kind ? "" : "income" })} />
        {filters.merchant && <Chip name="Kauppias" value={filters.merchant} onClear={() => set({ merchant: "" })} />}
        {any && (
          <button type="button" className="tx-fclear" onClick={clear}>
            Tyhjennä
          </button>
        )}
      </div>
    </div>
  );
}
