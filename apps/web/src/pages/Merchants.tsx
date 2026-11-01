import { UNKNOWN_MERCHANT } from "@banking/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, query } from "../api.ts";
import { CategoryPicker } from "../components/CategorySelect.tsx";
import { SEARCH_DELAY_MS } from "../components/FilterInputs.tsx";
import type { Sort } from "../components/table/sort.ts";
import { MerchantFilters } from "./transactions/FilterChips.tsx";
import { date, money } from "../format.ts";
import { t, tn } from "../text.ts";
import { navigate } from "../hooks.ts";
import { RULES_ANCHOR } from "../routes.ts";
import type { Meta, Scope } from "../types.ts";
import { type Column, Table } from "../components/table/Table.tsx";
import { Rules } from "./Rules.tsx";
import "../styles/categories.css";
import { Button } from "../components/ui/Button.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { Empty } from "../components/ui/Empty.tsx";
interface MerchantItem {
  merchant: string;
  category: string;
  count: number;
  totalCents: number;
  inCents: number;
  /** Money out per month whatever the period: an active series' own figure, else the last complete months over their number. */
  monthlyCents: number | null;
  lastDate: string;
  rule: { id: number; category: string } | null;
  /** Rows in other categories, most rows first. */
  otherCategories?: { category: string; count: number; totalCents: number; inCents: number }[];
}

const LIMIT = 200;

/**
 * The Kauppiaat tab of Tapahtumat: every merchant of a period with the category its rows go to, and the rules under
 * the table. The filters live in the address (`q`, `category`, `from`, `to`, `habit`), so a link from another page can
 * open a month, and `habit=1` keeps the merchants the recurring detection calls everyday purchases (the chip Arkiostot).
 */
export function Merchants({ meta, params, scope, anchor }: { meta: Meta; params: URLSearchParams; scope: Scope; anchor?: string }) {
  const filters = {
    q: params.get("q") ?? "",
    category: params.get("category") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    habit: params.get("habit") === "1",
  };
  const set = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch };
    navigate("transactions", { view: "merchants", q: next.q, category: next.category, from: next.from, to: next.to, habit: next.habit ? "1" : "" });
  };
  // the search box shows what is typed at once; the address (and so the server) follows after a pause
  const [draft, setDraft] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  const [sort, setSort] = useState<Sort<string>>(null);
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    setDraft(filters.q);
  }
  useEffect(() => {
    if (draft.trim() === filters.q) return;
    const timer = window.setTimeout(() => set({ q: draft.trim() }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filters is read from the render of this address
  }, [draft, filters.q]);
  const [items, setItems] = useState<MerchantItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const request = useRef(0);

  // a filter change replaces the list; after an edit the rows stay where they are
  const { q, category, from, to, habit } = filters;
  const load = useCallback(
    async (keep: boolean) => {
      const id = ++request.current;
      try {
        const r = await api<{ items: MerchantItem[] }>(`/api/merchants${query({ q, category, from, to, habit: habit ? "1" : "", scope, limit: LIMIT })}`);
        if (id !== request.current) return;
        setLoadError(null);
        setItems((old) => {
          if (!keep || !old) return r.items;
          const fresh = new Map(r.items.map((m) => [m.merchant, m]));
          return old.map((m) => fresh.get(m.merchant) ?? m);
        });
      } catch (err) {
        if (id === request.current) setLoadError((err as Error).message);
      }
    },
    [q, category, from, to, habit, scope],
  );
  useEffect(() => {
    void load(false);
  }, [load]);

  // an old address to the rules (#/rules, ?tab=rules) lands here with an anchor: scroll once the table above has its height
  const scrolledFor = useRef<string | undefined>(undefined);
  const loaded = items !== null || loadError !== null;
  useEffect(() => {
    if (anchor !== RULES_ANCHOR || !loaded || scrolledFor.current === anchor) return;
    scrolledFor.current = anchor;
    document.getElementById(RULES_ANCHOR)?.scrollIntoView({ block: "start" });
  }, [anchor, loaded]);

  // `what` and the merchant name the button that was pressed: a category change and a removed rule are two actions on one row
  const edit = async (m: MerchantItem, what: "category" | "rule", fn: () => Promise<{ changed: number }>, patch: Partial<MerchantItem>) => {
    if (busy) return;
    setBusy(`${what}:${m.merchant}`);
    setError(null);
    setChanged(null);
    try {
      const r = await fn();
      setChanged(r.changed);
      setItems((old) => old?.map((x) => (x.merchant === m.merchant ? { ...x, ...patch } : x)) ?? old);
      await load(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setCategoryOf = (m: MerchantItem, next: string) =>
    edit(m, "category", () => api<{ changed: number }>("/api/merchants/category", { method: "PUT", body: { merchant: m.merchant, category: next } }), {
      category: next,
      rule: { id: m.rule?.id ?? 0, category: next },
    });
  const removeRule = (m: MerchantItem) =>
    edit(m, "rule", () => api<{ changed: number }>("/api/merchants/rule", { method: "DELETE", body: { merchant: m.merchant } }), { rule: null });

  const err = error ?? loadError;
  const categoryLabel = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;
  const columns: Column<MerchantItem>[] = [
    {
      key: "merchant",
      label: t("mer.merchant"),
      kind: "text",
      rowHead: true,
      className: () => "m-name",
      sort: (m) => m.merchant,
      cell: (m) => (
        <>
          {/* the rows open for the period the figures add up */}
          <a href={`#/transactions${query({ merchant: m.merchant, from, to })}`}>{m.merchant}</a>
          {/* a bank takes loan instalments and fees: the total is not all in the category shown */}
          {!!m.otherCategories?.length && (
            <div className="sub">
              {t("mer.also", {
                list:
                  m.otherCategories
                    .slice(0, 2)
                    .map((o) => `${categoryLabel(o.category)} ${o.totalCents || !o.inCents ? money(o.totalCents, false) : `+${money(o.inCents, false)}`}`)
                    .join(", ") + (m.otherCategories.length > 2 ? ` ${t("mer.and_more", { count: m.otherCategories.length - 2 })}` : ""),
              })}
            </div>
          )}
        </>
      ),
    },
    {
      key: "category",
      label: t("mer.category"),
      kind: "text",
      className: () => "m-category",
      cell: (m) =>
        /* the category is only read on a closed row: the picker and the rule's removal are in the opened one */
        m.merchant === UNKNOWN_MERCHANT ? (
          <span className="small muted">{t("mer.unknown_hint")}</span>
        ) : (
          <>
            <span>{categoryLabel(m.category)}</span>
            {m.rule && <span className="badge">{t("mer.rule_badge")}</span>}
          </>
        ),
    },
    {
      key: "count",
      label: t("mer.count"),
      kind: "count",
      sort: (m) => m.count,
      cell: (m) => m.count,
    },
    {
      key: "total",
      label: t("mer.total"),
      kind: "money",
      main: true,
      sort: (m) => m.totalCents || m.inCents,
      cell: (m) => (m.totalCents || !m.inCents ? money(m.totalCents) : `+${money(m.inCents)}`),
    },
    {
      key: "monthly",
      label: t("mer.monthly"),
      kind: "money",
      /* money in has no monthly figure here: a salary payer shows a dash */
      sort: (m) => m.monthlyCents ?? null,
      cell: (m) => (m.monthlyCents ? money(m.monthlyCents, false) : "–"),
    },
    { key: "last", label: t("mer.last"), kind: "date", className: () => "m-last", sort: (m) => m.lastDate, cell: (m) => date(m.lastDate) },
  ];
  const narrowed = !!(q || category || from || to || habit);
  return (
    <>
      <div className="card">
        <div className="card-head tb">
          <div className="card-name">
            <h2>{t("mer.heading")}</h2>
          </div>
        </div>
        {err && <Notice tone="error">{err}</Notice>}
        {changed !== null && !error && (
          <Notice tone="good" role="status">
            {tn(changed, "mer.changed_one", "mer.changed_many")}
          </Notice>
        )}
        {/* the server sends the merchants largest money out first and an edit keeps the rows where they are: a ranking, so `ranked`.
            A row that shows only money in (`unranked`) is not in that ranking and carries no number. */}
        <Table
          caption={t("mer.heading")}
          rowsSearched
          searchLabel={t("mer.search")}
          view={{ query: draft, chip: null, group: null, sort }}
          onView={(next) => {
            setDraft(next.query);
            setSort(next.sort);
          }}
          toolbarExtra={<MerchantFilters filters={filters} categories={meta.categories} today={meta.today} set={set} />}
          rows={items ?? []}
          rowKey={(m) => m.merchant}
          drill={(m) =>
            /* the placeholder of rows without a name: a category for it would take every one of them */
            m.merchant === UNKNOWN_MERCHANT ? null : (
              <div className="m-detail">
                <CategoryPicker
                  categories={meta.categories}
                  value={m.category}
                  onChange={(c) => void setCategoryOf(m, c)}
                  ariaLabel={t("mer.category_of", { merchant: m.merchant })}
                  disabled={busy !== null}
                />
                {m.rule && (
                  <Button variant="link" disabled={busy !== null} aria-busy={busy === `rule:${m.merchant}` || undefined} onClick={() => void removeRule(m)} aria-label={t("mer.remove_rule_of", { merchant: m.merchant })}>
                    {t("mer.remove_rule")}
                  </Button>
                )}
              </div>
            )
          }
          drillLabel={(m) => t("mer.open", { merchant: m.merchant })}
          page={50}
          className="merchant-table ranked"
          rowClassName={(m) => (!m.totalCents && m.inCents ? "unranked" : undefined)}
          columns={columns}
        />
        {items && !items.length && <Empty>{narrowed ? t("mer.empty_narrowed") : t("mer.empty")}</Empty>}
        {!items && !loadError && <Empty>{t("mer.loading")}</Empty>}
        {items && items.length >= LIMIT && <div className="small muted">{t("mer.cut", { count: LIMIT })}</div>}
      </div>
      <Rules meta={meta} />
    </>
  );
}
