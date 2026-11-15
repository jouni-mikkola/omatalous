/**
 * The bar over the list of Tapahtumat. Decision: which payments the household looks at, and how to find one.
 *
 * The period and the search box come first. One action, Suodata, opens the rest (category, account, income only,
 * the marks the reader or the bank made). A limit that is set stands under the bar as a named chip with an x, so the
 * list is never narrowed by something the reader cannot see. The address holds every limit and the grouping, so a
 * limited list can be linked and the back button undoes a limit. A search being typed takes one place in the history,
 * not one for each pause (the page's `onSearch`).
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { SEARCH_DELAY_MS } from "../../components/FilterInputs.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { t } from "../../text.ts";
import type { Category } from "../../types.ts";
import { AccountMark, type AccountLook } from "./Marks.tsx";
import { CategoryIcon } from "./category-look.tsx";
import { CategoryMenu } from "./CategoryChip.tsx";
import { DateRange, type Period, periodLabel } from "./DateRange.tsx";
import { type Filters } from "./FilterChips.tsx";
import { Popover } from "./Popover.tsx";

/** What the list is grouped by: the days (the default) or the payees. */
type Grouping = "day" | "merchant";

const BAR_ID = "tx-bar";

/**
 * On a phone a long list leaves the bar far above. While the bar is out of sight past the top of the screen this button
 * sticks to the foot of the screen at the end of the list's card, so it never covers what stands after the list (tx-bar.css),
 * and takes the reader back to the bar, on its Suodata button.
 */
export function FilterShortcut() {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const bar = document.getElementById(BAR_ID);
    if (!bar || !("IntersectionObserver" in window)) return;
    const watch = new IntersectionObserver(([e]) => setAway(!!e && !e.isIntersecting && e.boundingClientRect.bottom < 0));
    watch.observe(bar);
    return () => watch.disconnect();
  }, []);
  if (!away) return null;
  return (
    <button
      type="button"
      className="btn tx-shortcut"
      onClick={() => {
        window.scrollTo({ top: 0 });
        document.querySelector<HTMLElement>(`#${BAR_ID} .tx-filter-btn`)?.focus({ preventScroll: true });
      }}
    >
      {t("fchip.filter")}
    </button>
  );
}

const Caret = () => (
  <svg className="tx-chip-caret" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M2 3.5l3 3 3-3" />
  </svg>
);

/** The period, always there: "Koko historia" until one is set, then its name with an x that returns to the whole history. */
function PeriodControl({ period, today, set }: { period: Period; today: string; set: (patch: Partial<Filters>) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const isSet = !!(period.from || period.to);
  return (
    <span className={`tx-fchip tx-period${isSet ? " set" : ""}`}>
      <button ref={button} type="button" className="tx-fchip-main" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="tx-fchip-name">{t("fchip.period")}</span>
        <span className="tx-fchip-value">{isSet ? periodLabel(period, today) : t("range.all")}</span>
        <Caret />
      </button>
      {isSet && (
        <button type="button" className="tx-fchip-x" aria-label={t("fchip.remove", { name: t("fchip.period") })} onClick={() => set({ from: "", to: "" })}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
          </svg>
        </button>
      )}
      <Popover open={open} onClose={() => setOpen(false)} anchor={button} label={t("fchip.period")}>
        <DateRange
          value={period}
          today={today}
          onCommit={(p) => {
            setOpen(false);
            set(p);
          }}
        />
      </Popover>
    </span>
  );
}

/** The search box. What is typed shows at once; the page's address (and so the server) follows after a pause, and Enter or leaving the box settles it. */
function SearchBox({ q, onSearch }: { q: string; onSearch: (q: string, settled: boolean) => void }) {
  const [draft, setDraft] = useState(q);
  const [seenQ, setSeenQ] = useState(q);
  if (seenQ !== q) {
    setSeenQ(q);
    setDraft(q);
  }
  useEffect(() => {
    if (draft.trim() === q) return;
    const timer = window.setTimeout(() => onSearch(draft.trim(), false), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSearch reads the page's render of this address
  }, [draft, q]);
  const settle = () => onSearch(draft.trim(), true);
  return (
    <form
      className="tx-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        settle();
      }}
    >
      <input type="search" value={draft} placeholder={t("tx.search")} aria-label={t("tx.search")} onChange={(e) => setDraft(e.target.value)} onBlur={settle} />
      {draft && (
        <button
          type="button"
          className="tx-search-clear"
          aria-label={t("fchip.search_clear")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setDraft("");
            onSearch("", true);
          }}
        >
          ×
        </button>
      )}
    </form>
  );
}

interface Option {
  key: string;
  node: ReactNode;
  selected: boolean;
  pick: () => void;
}

/** A list of choices the arrow keys walk through; the first takes the Tab key. A chosen one picked again is let go. */
function Options({ label, items }: { label: string; items: Option[] }) {
  return (
    <>
      <div className="tx-fgroup">{label}</div>
      <ul
        className="tx-acctlist"
        role="listbox"
        aria-label={label}
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
        {items.map((o, i) => (
          <li
            key={o.key}
            role="option"
            tabIndex={i === 0 ? 0 : -1}
            aria-selected={o.selected}
            onClick={o.pick}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              o.pick();
            }}
          >
            {o.node}
          </li>
        ))}
      </ul>
    </>
  );
}

interface PanelProps {
  filters: Filters;
  categories: Category[];
  accounts: { id: string; name: string }[];
  severalAccounts: boolean;
  looks: Map<string, AccountLook>;
  /** The marks a row can have (Käsin luokitellut, Varaukset), the page's `rowChips`. */
  marks: { key: string; label: string }[];
  set: (patch: Partial<Filters>) => void;
}

/** What Suodata opens: the category (its own list, with a way back), then the limits that are a choice among a few. */
function FilterPanel({ filters, categories, accounts, severalAccounts, looks, marks, set, close }: PanelProps & { close: () => void }) {
  const [step, setStep] = useState<"list" | "category">("list");
  const picked = categories.find((c) => c.id === filters.category);
  const choose = (patch: Partial<Filters>) => () => {
    close();
    set(patch);
  };
  if (step === "category") {
    return (
      <>
        <button type="button" className="tx-fback" onClick={() => setStep("list")}>
          <span aria-hidden="true">‹</span> {t("fchip.filter")}
        </button>
        <CategoryMenu categories={categories} value={filters.category} onPick={(id) => choose({ category: id })()} />
      </>
    );
  }
  const limits: Option[] = [
    { key: "income", node: <span className="tx-acctlist-name">{t("fchip.income_only")}</span>, selected: filters.kind === "income", pick: choose({ kind: filters.kind ? "" : "income" }) },
    ...marks.map((m) => ({ key: m.key, node: <span className="tx-acctlist-name">{m.label}</span>, selected: filters.chip === m.key, pick: choose({ chip: filters.chip === m.key ? "" : m.key }) })),
  ];
  return (
    <>
      <button type="button" className="tx-frow" onClick={() => setStep("category")}>
        <span>{t("fchip.category")}</span>
        <span className="tx-frow-value">{picked?.label ?? (filters.category || t("table.all"))}</span>
        <svg className="tx-frow-go" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3.5 2l3 3-3 3" />
        </svg>
      </button>
      <Options label={t("fchip.limits")} items={limits} />
      {severalAccounts && (
        <Options
          label={t("fchip.account")}
          items={accounts.map((a) => ({
            key: a.id,
            selected: filters.accountId === a.id,
            pick: choose({ accountId: filters.accountId === a.id ? "" : a.id }),
            node: (
              <>
                <AccountMark look={looks.get(a.id)} fallback={a.name} />
                <span className="tx-acctlist-name">{looks.get(a.id)?.name ?? a.name}</span>
              </>
            ),
          }))}
        />
      )}
    </>
  );
}

/** A limit that is set: its name and value, and an x that lets it go. */
function LimitChip({ name, value, icon, onClear }: { name: string; value?: string; icon?: ReactNode; onClear: () => void }) {
  return (
    <span className="tx-fchip set">
      <span className="tx-fchip-main tx-fchip-static">
        <span className="tx-fchip-name">{name}</span>
        {icon}
        {value && <span className="tx-fchip-value">{value}</span>}
      </span>
      <button type="button" className="tx-fchip-x" aria-label={t("fchip.remove", { name })} onClick={onClear}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
        </svg>
      </button>
    </span>
  );
}

/** How the list is laid out: by day, or under each payee. Not a limit, so it has no chip. */
export function GroupChoice({ group, onGroup }: { group: Grouping; onGroup: (g: Grouping) => void }) {
  return (
    <Segmented<Grouping>
      className="tx-group"
      label={t("table.group")}
      value={group}
      options={[
        { value: "day", label: t("tx.group_day") },
        { value: "merchant", label: t("tx.group_merchant") },
      ]}
      onChange={onGroup}
    />
  );
}

export function TxBar({ today, clear, onSearch, ...panel }: PanelProps & { today: string; clear: () => void; onSearch: (q: string, settled: boolean) => void }) {
  const { filters, categories, looks, marks, set } = panel;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const period: Period = { from: filters.from, to: filters.to };
  const picked = categories.find((c) => c.id === filters.category);
  const mark = marks.find((m) => m.key === filters.chip);
  const limited = !!(filters.category || filters.accountId || filters.kind || filters.chip || filters.merchant);
  return (
    <div id={BAR_ID} className="tx-bar" role="group" aria-label={t("fchip.filters")}>
      <div className="tx-bar-main">
        <SearchBox q={filters.q} onSearch={onSearch} />
        <PeriodControl period={period} today={today} set={set} />
        <span className="tx-filter">
          <button ref={button} type="button" className="btn tx-filter-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {t("fchip.filter")}
          </button>
          <Popover open={open} onClose={() => setOpen(false)} anchor={button} label={t("fchip.filter")}>
            <FilterPanel {...panel} close={() => setOpen(false)} />
          </Popover>
        </span>
      </div>
      {limited && (
        <div className="tx-fchips" role="group" aria-label={t("fchip.limits")}>
          {filters.category && <LimitChip name={t("fchip.category")} value={picked?.label ?? filters.category} icon={picked && <CategoryIcon category={picked} />} onClear={() => set({ category: "" })} />}
          {filters.accountId && <LimitChip name={t("fchip.account")} value={looks.get(filters.accountId)?.name ?? filters.accountId} onClear={() => set({ accountId: "" })} />}
          {filters.kind && <LimitChip name={t("fchip.income_only")} onClear={() => set({ kind: "" })} />}
          {filters.chip && <LimitChip name={mark?.label ?? filters.chip} onClear={() => set({ chip: "" })} />}
          {filters.merchant && <LimitChip name={t("fchip.merchant")} value={filters.merchant} onClear={() => set({ merchant: "" })} />}
          <button type="button" className="tx-fclear" onClick={clear}>
            {t("tx.clear")}
          </button>
        </div>
      )}
    </div>
  );
}
