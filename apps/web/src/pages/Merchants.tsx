import { UNKNOWN_MERCHANT } from "@banking/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, query } from "../api.ts";
import { CategoryPicker, CategorySelect } from "../components/CategorySelect.tsx";
import { DateFilter, SearchBox } from "../components/FilterInputs.tsx";
import { date, money, plural } from "../format.ts";
import { navigate } from "../hooks.ts";
import { RULES_ANCHOR } from "../routes.ts";
import type { Meta } from "../types.ts";
import { Rules } from "./Rules.tsx";
import "../styles/categories.css";

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

/** What Kuussa of a merchant without an active series is, in words: the complete months it averages. */
export const monthsBasis = (months: number): string =>
  months === 0 ? "vasta kun ensimmäinen kuukausi on valmis" : months === 1 ? "viimeisen valmiin kuukauden summa" : `keskiarvo viimeisiltä ${months} valmiilta kuukaudelta`;

/**
 * The Kauppiaat tab of Tapahtumat: every merchant of a period with the category its rows go to, and the rules under
 * the table. The filters live in the address (`q`, `category`, `from`, `to`, `habit`), so a link from another page can
 * open a month, and Arkiostot keeps the merchants the recurring detection calls everyday purchases.
 */
export function Merchants({ meta, params, anchor }: { meta: Meta; params: URLSearchParams; anchor?: string }) {
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
  const [items, setItems] = useState<MerchantItem[] | null>(null);
  const [months, setMonths] = useState(1);
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
        const r = await api<{ items: MerchantItem[]; months: number }>(`/api/merchants${query({ q, category, from, to, habit: habit ? "1" : "", limit: LIMIT })}`);
        if (id !== request.current) return;
        setLoadError(null);
        setMonths(r.months);
        setItems((old) => {
          if (!keep || !old) return r.items;
          const fresh = new Map(r.items.map((m) => [m.merchant, m]));
          return old.map((m) => fresh.get(m.merchant) ?? m);
        });
      } catch (err) {
        if (id === request.current) setLoadError((err as Error).message);
      }
    },
    [q, category, from, to, habit],
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

  const edit = async (m: MerchantItem, fn: () => Promise<{ changed: number }>, patch: Partial<MerchantItem>) => {
    if (busy) return;
    setBusy(m.merchant);
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
    edit(m, () => api<{ changed: number }>("/api/merchants/category", { method: "PUT", body: { merchant: m.merchant, category: next } }), {
      category: next,
      rule: { id: m.rule?.id ?? 0, category: next },
    });
  const removeRule = (m: MerchantItem) =>
    edit(m, () => api<{ changed: number }>("/api/merchants/rule", { method: "DELETE", body: { merchant: m.merchant } }), { rule: null });

  const err = error ?? loadError;
  const categoryLabel = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;
  const period = from || to;
  const narrowed = !!(q || category || period || habit);
  return (
    <>
      <div className="filters">
        <SearchBox value={q} onSearch={(next) => set({ q: next })} label="Hae kauppiasta" />
        <CategorySelect categories={meta.categories} value={category} onChange={(next) => set({ category: next })} allowEmpty ariaLabel="Suodata kategorialla" />
        <div className="segmented" role="group" aria-label="Kauppiaiden rajaus">
          <button type="button" aria-pressed={!habit} onClick={() => set({ habit: false })}>
            Kaikki
          </button>
          <button type="button" aria-pressed={habit} onClick={() => set({ habit: true })}>
            Arkiostot
          </button>
        </div>
        <DateFilter value={from} onCommit={(next) => set({ from: next })} label="Alkaen" />
        <DateFilter value={to} onCommit={(next) => set({ to: next })} label="Asti" />
        {narrowed && (
          <button className="btn btn-small" type="button" onClick={() => navigate("transactions", { view: "merchants" })}>
            Tyhjennä
          </button>
        )}
      </div>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Kauppiaat</h2>
            <div className="card-sub">
              {items
                ? `${plural(items.length, "kauppias", "kauppiasta")}, summat ${period ? "valitulta jaksolta" : "koko historiasta"}, omat siirrot pois lukien. Kuussa: toistuvan maksun kuukausihinta, muilla ${monthsBasis(months)}.`
                : "…"}
              {habit && " Arkiostot ovat usein toistuvia pieniä ostoja, jotka jatkuvat yhä."}
            </div>
          </div>
          <button className="btn btn-small" type="button" onClick={() => document.getElementById(RULES_ANCHOR)?.scrollIntoView({ block: "start" })}>
            Säännöt
          </button>
        </div>
        {err && <div className="error">{err}</div>}
        {changed !== null && !error && (
          <div className="notice good" role="status">
            Muutettu {plural(changed, "tapahtuma", "tapahtumaa")}.
          </div>
        )}
        <div className="table-wrap">
          <table className="merchant-table">
            <thead>
              <tr>
                <th>Kauppias</th>
                <th>Kategoria</th>
                <th className="num">Tapahtumia</th>
                <th className="num">Yhteensä</th>
                <th className="num">Kuussa</th>
                <th>Viimeksi</th>
              </tr>
            </thead>
            <tbody>
              {items?.map((m) => (
                <tr key={m.merchant}>
                  <td className="m-name">
                    {/* the rows open for the period the figures add up */}
                    <a href={`#/transactions${query({ merchant: m.merchant, from, to })}`}>{m.merchant}</a>
                    {/* a bank takes loan instalments and fees: the total is not all in the category shown */}
                    {!!m.otherCategories?.length && (
                      <div className="sub">
                        Myös{" "}
                        {m.otherCategories
                          .slice(0, 2)
                          .map((o) => `${categoryLabel(o.category)} ${o.totalCents || !o.inCents ? money(o.totalCents, false) : `+${money(o.inCents, false)}`}`)
                          .join(", ")}
                        {m.otherCategories.length > 2 && ` ja ${m.otherCategories.length - 2} muuta`}
                      </div>
                    )}
                  </td>
                  <td className="m-category">
                    {/* the placeholder of rows without a name: a category for it would take every one of them */}
                    {m.merchant === UNKNOWN_MERCHANT ? (
                      <span className="small muted">Vaihda kategoria tapahtumalta</span>
                    ) : (
                      <>
                        <CategoryPicker
                          categories={meta.categories}
                          value={m.category}
                          onChange={(c) => void setCategoryOf(m, c)}
                          ariaLabel={`Kategoria: ${m.merchant}`}
                          disabled={busy !== null}
                        />
                        {m.rule && (
                          <>
                            <span className="badge">Sääntö</span>
                            <button className="btn btn-small" type="button" disabled={busy !== null} onClick={() => void removeRule(m)} aria-label={`Poista sääntö: ${m.merchant}`}>
                              Poista sääntö
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                  <td className="num" data-label="Tapahtumia">
                    <span className="hide-phone">{m.count}</span>
                    <span className="phone-only">{plural(m.count, "tapahtuma", "tapahtumaa")}</span>
                  </td>
                  <td className="num" data-label="Yhteensä">{m.totalCents || !m.inCents ? money(m.totalCents) : `+${money(m.inCents)}`}</td>
                  {/* money in has no monthly figure here: a salary payer shows a dash */}
                  <td className="num" data-label="Kuussa">
                    {m.monthlyCents ? (
                      <>
                        <span className="hide-phone">{money(m.monthlyCents, false)}</span>
                        <span className="phone-only">{money(m.monthlyCents, false)} kuussa</span>
                      </>
                    ) : (
                      <span className="hide-phone">–</span>
                    )}
                  </td>
                  <td className="m-last" data-label="Viimeksi">{date(m.lastDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items && !items.length && <div className="empty">{narrowed ? "Ei kauppiaita näillä rajauksilla." : "Ei vielä kauppiaita."}</div>}
          {!items && !loadError && <div className="empty">Ladataan…</div>}
        </div>
        {items && items.length >= LIMIT && <div className="small muted">Näytetään {LIMIT} suurinta. Rajaa hakua.</div>}
      </div>
      <Rules meta={meta} />
    </>
  );
}
