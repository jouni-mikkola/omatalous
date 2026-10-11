import { useCallback, useEffect, useRef, useState } from "react";
import { api, query } from "../api.ts";
import { CategoryPicker, CategorySelect } from "../components/CategorySelect.tsx";
import { date, money, plural } from "../format.ts";
import type { Meta } from "../types.ts";

interface MerchantItem {
  merchant: string;
  category: string;
  count: number;
  totalCents: number;
  inCents: number;
  lastDate: string;
  rule: { id: number; category: string } | null;
  /** Rows in other categories, most rows first. */
  otherCategories?: { category: string; count: number; totalCents: number; inCents: number }[];
}

const LIMIT = 200;

export function Merchants({ meta }: { meta: Meta }) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<MerchantItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  // a filter change replaces the list; after an edit the rows stay where they are
  const load = useCallback(
    async (keep: boolean) => {
      const id = ++request.current;
      try {
        const r = await api<{ items: MerchantItem[] }>(`/api/merchants${query({ q, category, limit: LIMIT })}`);
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
    [q, category],
  );
  useEffect(() => {
    void load(false);
  }, [load]);

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
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Kauppiaat</h2>
          <div className="card-sub">{items ? `${plural(items.length, "kauppias", "kauppiasta")}, summat koko historiasta` : "…"}</div>
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <input type="search" placeholder="Hae kauppiasta" value={text} onChange={(e) => setText(e.target.value)} aria-label="Hae kauppiasta" />
          <CategorySelect categories={meta.categories} value={category} onChange={setCategory} allowEmpty ariaLabel="Suodata kategorialla" />
        </div>
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
              <th>Viimeksi</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((m) => (
              <tr key={m.merchant}>
                <td className="m-name">
                  <a href={`#/transactions${query({ merchant: m.merchant })}`}>{m.merchant}</a>
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
                </td>
                <td className="num" data-label="Tapahtumia">
                  <span className="hide-phone">{m.count}</span>
                  <span className="phone-only">{plural(m.count, "tapahtuma", "tapahtumaa")}</span>
                </td>
                <td className="num" data-label="Yhteensä">{m.totalCents || !m.inCents ? money(m.totalCents) : `+${money(m.inCents)}`}</td>
                <td className="m-last" data-label="Viimeksi">{date(m.lastDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items && !items.length && <div className="empty">{q || category ? "Ei kauppiaita näillä rajauksilla." : "Ei vielä kauppiaita."}</div>}
        {!items && !loadError && <div className="empty">Ladataan…</div>}
      </div>
      {items && items.length >= LIMIT && <div className="small muted">Näytetään {LIMIT} suurinta. Rajaa hakua.</div>}
    </div>
  );
}
