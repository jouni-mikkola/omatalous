import { memo, useCallback, useEffect, useRef, useState } from "react";
import { api, query } from "../api.ts";
import { CategoryPicker, CategorySelect } from "../components/CategorySelect.tsx";
import { CADENCE_LABEL, date, money, plural } from "../format.ts";
import { navigate, useApi } from "../hooks.ts";
import type { Category, Meta, Scope, TransactionItem } from "../types.ts";
import "../styles/transactions.css";

interface MerchantHistory {
  merchant: string;
  count: number;
  outCents: number;
  inCents: number;
  firstDate: string;
  lastDate: string;
  months: number;
  category: string;
  recurring: { cadence: string; active: boolean; nextDate: string | null; typicalAmountCents: number } | null;
}

/**
 * The whole history of the merchant the list is filtered to, whatever period or account the filters below
 * pick. It loads on its own, so a slow history never holds the list back.
 */
function MerchantSummary({ merchant, scope, refresh, categoryLabel }: { merchant: string; scope: Scope; refresh: number; categoryLabel: (id: string) => string }) {
  const { data, reload } = useApi<{ summary: MerchantHistory | null }>(`/api/merchants/summary${query({ merchant, scope })}`);
  // a category changed in the list below moves the category shown here
  useEffect(() => {
    if (refresh > 0) reload();
  }, [refresh, reload]);
  const s = data?.summary;
  if (!s || s.merchant !== merchant) return null;
  const facts: [string, string][] = [];
  if (s.outCents > 0) facts.push(["Maksettu yhteensä", money(s.outCents)]);
  if (s.inCents > 0) facts.push(["Saatu yhteensä", money(s.inCents)]);
  facts.push(["Maksuja", String(s.count)]);
  if (s.outCents > 0) facts.push(["Keskimäärin kuukaudessa", money(Math.round(s.outCents / s.months))]);
  facts.push(["Ensimmäinen", date(s.firstDate)], ["Viimeisin", date(s.lastDate)]);
  if (s.recurring?.active) {
    facts.push(["Toistuu", CADENCE_LABEL[s.recurring.cadence] ?? s.recurring.cadence]);
    if (s.recurring.nextDate) facts.push(["Seuraava odotettu", date(s.recurring.nextDate)]);
  }
  return (
    <section className="card" aria-label={`Yhteenveto: ${s.merchant}`}>
      <div className="card-head">
        <div>
          <h2>{s.merchant}</h2>
          <div className="card-sub">
            {categoryLabel(s.category)} · koko historia
            {s.outCents > 0 && ` · keskiarvo ${s.months} kuukaudelta, joina maksuja oli`}
          </div>
        </div>
      </div>
      <dl className="kv">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="k">{k}</dt>
            <dd className="v">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const PAGE = 100;
const MAX_ROWS = 500;

export function Transactions({ meta, params, scope }: { meta: Meta; params: URLSearchParams; scope: Scope }) {
  const accounts = [...meta.accounts, ...(scope === "household" ? meta.sharedAccounts : [])];
  const filters = {
    q: params.get("q") ?? "",
    category: params.get("category") ?? "",
    // a shared account stays in the address after switching back to the own view
    accountId: accounts.some((a) => a.id === params.get("accountId")) ? params.get("accountId")! : "",
    merchant: params.get("merchant") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  // a filter change starts from the first page, also when it goes back to an earlier filter;
  // resetting during render means the request for the old page size is never sent
  const filterKey = `${scope}?${params.toString()}`;
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE });
  if (paging.key !== filterKey) setPaging({ key: filterKey, limit: PAGE });
  const { limit } = paging;
  const [remember, setRemember] = useState(true);
  const rememberRef = useRef(remember);
  rememberRef.current = remember;
  const [saving, setSaving] = useState<{ id: string; category: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [changed, setChanged] = useState<{ count: number; merchant: string; category: string; rule: boolean } | null>(null);
  const [edits, setEdits] = useState(0);
  const { data, error, loading, reload } = useApi<{ total: number; inCents: number; outCents: number; items: TransactionItem[] }>(`/api/transactions${query({ ...filters, scope, limit })}`);
  const anyOwn = data?.items.some((t) => t.own) ?? false;
  const transferIds = useRef(new Set<string>());
  transferIds.current = new Set(data?.items.filter((t) => t.isTransfer).map((t) => t.id));
  const merchantOf = useRef(new Map<string, string>());
  merchantOf.current = new Map(data?.items.map((t) => [t.id, t.merchant]));

  const set = (patch: Partial<typeof filters>) => navigate("transactions", { ...filters, ...patch });
  const accountName = (id: string) => {
    const shared = meta.sharedAccounts.find((a) => a.id === id);
    return shared ? `${shared.name} (${shared.ownerName})` : (accounts.find((a) => a.id === id)?.name ?? id);
  };
  const categoryLabel = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;

  // stable, so the rows (memo) do not re-render while the user types or ticks the box
  const recategorize = useCallback(
    async (id: string, category: string) => {
      // an own transfer is neutral; giving it a spending category counts the money twice
      const kind = meta.categories.find((c) => c.id === category)?.kind;
      if (transferIds.current.has(id) && kind !== "transfer" && !window.confirm("Tämä on oma siirto. Muutetaanko silti?")) return;
      const createRule = rememberRef.current;
      setSaving({ id, category });
      setSaveError(null);
      setChanged(null);
      try {
        const r = await api<{ changed?: number }>(`/api/transactions/${encodeURIComponent(id)}`, { method: "PATCH", body: { category, createRule } });
        setChanged({
          count: typeof r?.changed === "number" ? r.changed : 1,
          merchant: merchantOf.current.get(id) ?? "",
          category: meta.categories.find((c) => c.id === category)?.label ?? category,
          rule: createRule,
        });
        setEdits((n) => n + 1);
        reload();
      } catch (err) {
        setSaveError((err as Error).message);
        setSaving(null);
      }
    },
    [reload, meta.categories],
  );
  // the saved value shows until the reload settles; a failed reload must not leave the select disabled
  useEffect(() => {
    if (!loading) setSaving(null);
  }, [loading]);

  return (
    <div className="stack">
      {filters.merchant && <MerchantSummary merchant={filters.merchant} scope={scope} refresh={edits} categoryLabel={categoryLabel} />}
      {!filters.merchant && !filters.q && (
        <Uncategorised
          categories={meta.categories}
          refresh={edits}
          onSaved={reload}
        />
      )}
      <div className="filters">
        <SearchBox value={filters.q} onSearch={(q) => set({ q })} />
        <CategorySelect categories={meta.categories} value={filters.category} onChange={(category) => set({ category })} allowEmpty />
        <select value={filters.accountId} onChange={(e) => set({ accountId: e.target.value })} aria-label="Tili">
          <option value="">Kaikki tilit</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountName(a.id)}
            </option>
          ))}
        </select>
        <DateFilter value={filters.from} onCommit={(from) => set({ from })} label="Alkaen" />
        <DateFilter value={filters.to} onCommit={(to) => set({ to })} label="Asti" />
        {filters.merchant && (
          <span className="badge">
            {filters.merchant}{" "}
            <button className="icon-btn" onClick={() => set({ merchant: "" })} aria-label="Poista kauppiassuodatin">
              ×
            </button>
          </span>
        )}
        {Object.values(filters).some(Boolean) && (
          <button className="btn btn-small" onClick={() => navigate("transactions")}>
            Tyhjennä
          </button>
        )}
      </div>

      <div className={`card ${loading ? "loading" : ""}`}>
        <div className="card-head">
          <div>
            <h2>Tapahtumat</h2>
            <div className="card-sub">
              {data ? plural(data.total, "tapahtuma", "tapahtumaa") : "…"}
              {/* every matching row, loaded or not: ulos and sisään apart, a net of both says little */}
              {data && data.total > 0 && (
                <>
                  {data.outCents > 0 && ` · ulos ${money(data.outCents)}`}
                  {data.inCents > 0 && ` · sisään ${money(data.inCents)}`}
                </>
              )}
            </div>
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            {anyOwn && (
              <label className="small muted">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Käytä samaa kategoriaa kauppiaan muissa tapahtumissa
              </label>
            )}
            <a className="btn btn-small" href={`/api/export/transactions.csv${query({ ...filters, from: filters.from || "2000-01-01", to: filters.to || meta.today, scope })}`} download>
              Lataa CSV
            </a>
          </div>
        </div>
        {(error ?? saveError) && (
          <div className="error" role="alert">
            {error ?? saveError}{" "}
            {error && (
              <button className="btn btn-small" type="button" onClick={reload}>
                Yritä uudelleen
              </button>
            )}
          </div>
        )}
        {changed !== null && !saveError && (
          <div className="notice good" role="status">
            {changed.rule && changed.merchant
              ? `${changed.merchant}: ${plural(changed.count, "tapahtuma", "tapahtumaa")} siirrettiin kategoriaan ${changed.category}. Uudet saman kauppiaan tapahtumat menevät samaan kategoriaan.`
              : `Tapahtuma siirrettiin kategoriaan ${changed.category}. Vain tämä yksi tapahtuma muuttui.`}
          </div>
        )}
        <div className="table-wrap">
          <table className="tx-table">
            <thead>
              <tr>
                <th>Päivä</th>
                <th>Kauppias</th>
                <th className="tx-category">Kategoria</th>
                <th className="num">Summa</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((t) => (
                <TxRow
                  key={t.id}
                  t={t}
                  account={accountName(t.accountId)}
                  categories={meta.categories}
                  categoryLabel={categoryLabel(t.category)}
                  pending={saving?.id === t.id ? saving.category : null}
                  onCategory={recategorize}
                />
              ))}
            </tbody>
          </table>
          {data && !data.items.length && (
            <div className="empty">
              {Object.values(filters).some(Boolean) ? "Ei tapahtumia näillä rajauksilla. Muuta hakua tai paina Tyhjennä." : "Tapahtumia ei ole vielä. Yhdistä pankki tai tuo CSV kohdassa Asetukset."}
            </div>
          )}
        </div>
        {data && data.total > data.items.length && (
          <div className="form-row">
            <button className="btn" onClick={() => setPaging({ key: filterKey, limit: limit + PAGE })} disabled={loading || limit >= MAX_ROWS}>
              Näytä lisää
            </button>
            {limit >= MAX_ROWS && <span className="small muted">Näytetään enintään {MAX_ROWS}. Rajaa hakua.</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Keeps the typed text to itself, so typing does not re-render the table.
 * The list follows the text after a short pause; Enter searches at once.
 */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text.trim() === value.trim()) return;
    const timer = window.setTimeout(() => onSearch(text.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [text, value, onSearch]);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(text.trim());
      }}
    >
      <input type="search" placeholder="Hae kauppiasta tai viestiä" value={text} onChange={(e) => setText(e.target.value)} aria-label="Hae kauppiasta tai viestiä" />
    </form>
  );
}

const TxRow = memo(function TxRow({
  t,
  account,
  categories,
  categoryLabel,
  pending,
  onCategory,
}: {
  t: TransactionItem;
  account: string;
  categories: Category[];
  categoryLabel: string;
  pending: string | null;
  onCategory: (id: string, category: string) => void;
}) {
  const detail = [t.counterparty, t.description].filter(Boolean).join(" · ");
  const company = t.industry ? [t.industry.companyName, t.industry.businessId, t.industry.label].filter(Boolean).join(", ") : null;
  // rendered twice: in its own column, and under the merchant on a phone where that column is hidden (transactions.css)
  const category = (
    <>
      {t.own ? (
        <CategoryPicker categories={categories} value={pending ?? t.category} onChange={(c) => onCategory(t.id, c)} ariaLabel={`Kategoria: ${t.merchant}`} disabled={pending !== null} />
      ) : (
        <span title="Jaettu tili, vain omistaja voi muuttaa">{categoryLabel}</span>
      )}
      {t.categorySource === "user" && <span className="badge">käsin</span>}
      {t.categorySource === "match" && (
        <span className="badge" title="Rahaa takaisin aiemmasta maksusta. Se vähentää sen menoa eikä ole tuloa.">
          palautus
        </span>
      )}
      {company && (
        <span className="badge" title={company}>
          YTJ
        </span>
      )}
    </>
  );
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>{date(t.bookingDate)}</td>
      <td>
        <a href={`#/transactions?merchant=${encodeURIComponent(t.merchant)}`}>{t.merchant}</a>
        {t.status === "pending" && <span className="badge warn">varaus</span>}
        {t.isTransfer && <span className="badge">oma siirto</span>}
        <div className="sub" title={detail}>
          {detail || "–"} · {account}
        </div>
        <div className="tx-category-phone">{category}</div>
      </td>
      <td className="tx-category">{category}</td>
      <td className={`num ${t.amountCents > 0 ? "amount-in" : ""}`}>{money(t.amountCents)}</td>
    </tr>
  );
});

/**
 * A date input that changes the filter only once the date is complete.
 * While the year is being typed the browser reports "0002-03-15" and then
 * "", and navigating on each of those would wipe the field.
 */
function DateFilter({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (v: string) => {
    if (v !== value && (v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "1990-01-01"))) onCommit(v);
  };
  return (
    <label className="date-filter">
      <span>{label}</span>
      <input
        type="date"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          // a picked date (or a fully typed one) applies at once
          if (/^(19|20)\d{2}-\d{2}-\d{2}$/.test(e.target.value)) commit(e.target.value);
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => e.key === "Enter" && commit(draft)}
      />
    </label>
  );
}

interface UncategorisedItem {
  merchant: string;
  totalCents: number;
  count: number;
  lastDate: string;
}

/**
 * Merchants that landed in "Muut menot" by default, largest first. Picking a
 * category saves a rule for the merchant, so the rows and future ones move.
 */
function Uncategorised({
  categories,
  refresh,
  onSaved,
}: {
  categories: Category[];
  /** Changes when a category was changed in the list below. */
  refresh: number;
  onSaved: () => void;
}) {
  const { data, reload } = useApi<{ items: UncategorisedItem[] }>("/api/merchants/uncategorised");
  const seen = useRef(refresh);
  useEffect(() => {
    if (seen.current === refresh) return;
    seen.current = refresh;
    reload();
  }, [refresh, reload]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  if (!data?.items.length) return null;
  const total = data.items.reduce((s, i) => s + i.totalCents, 0);
  // the list below is what the page is for: the card starts short
  const rows = data.items.slice(0, more ? 10 : 5);

  const save = async (merchant: string, category: string) => {
    if (!category || busy) return;
    setBusy(merchant);
    setError(null);
    try {
      await api("/api/rules", { method: "POST", body: { field: "merchant_exact", pattern: merchant, category } });
      reload();
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Luokittelematta</h2>
          <div className="card-sub">
            {plural(data.items.length, "kauppias", "kauppiasta")}, {money(total, false)}
          </div>
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <a className="btn btn-small" href="#/transactions?category=other">
            Näytä kaikki
          </a>
          <a className="btn btn-small" href="#/categories">
            Kaikki kauppiaat
          </a>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <ul className="uncat-list">
        {rows.map((m) => (
          <li key={m.merchant}>
            <div className="uncat-name">
              <a href={`#/transactions${query({ merchant: m.merchant })}`}>{m.merchant}</a>
              <div className="sub">
                {plural(m.count, "tapahtuma", "tapahtumaa")} · viimeksi {date(m.lastDate)}
              </div>
            </div>
            <span className="num">{money(m.totalCents)}</span>
            <CategorySelect
              categories={categories.filter((c) => c.id !== "other")}
              value=""
              allowEmpty
              emptyLabel="Valitse kategoria"
              ariaLabel={`Kategoria: ${m.merchant}`}
              disabled={busy !== null}
              onChange={(c) => void save(m.merchant, c)}
            />
          </li>
        ))}
      </ul>
      {data.items.length > 5 && (
        <button className="btn btn-small" type="button" onClick={() => setMore((v) => !v)} aria-expanded={more}>
          {more ? "Näytä vähemmän" : "Näytä lisää"}
        </button>
      )}
    </div>
  );
}
