import { UNKNOWN_MERCHANT } from "@banking/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, query } from "../api.ts";
import { CategorySelect } from "../components/CategorySelect.tsx";
import { FilterChip } from "../components/FilterChip.tsx";
import { DateFilter, FilterToggle, SearchBox } from "../components/FilterInputs.tsx";
import { CADENCE_LABEL, date, dayHeading, money, plural } from "../format.ts";
import { navigate, useApi } from "../hooks.ts";
import type { Category, Meta, Scope } from "../types.ts";
import { Merchants } from "./Merchants.tsx";
import { byDay, type ListedRow, TxItem, TxRow, usePhone } from "./TransactionRows.tsx";
import "../styles/transactions.css";

interface MerchantHistory {
  merchant: string;
  count: number;
  outCents: number;
  inCents: number;
  firstDate: string;
  lastDate: string;
  category: string;
  /** The figure Kauppiaat shows: an active series' own, else the last complete months (`months`) and their average. */
  monthly: { monthlyCents: number | null; yearCents: number; months: number; fromSeries: boolean };
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
  const m = s.monthly;
  if (m.fromSeries) facts.push(["Kuussa", money(m.monthlyCents ?? 0)], ["Vuodessa", money(m.yearCents)]);
  else if (m.monthlyCents) facts.push([m.months === 1 ? "Viimeinen valmis kuukausi" : `Viimeiset ${m.months} kuukautta`, money(m.yearCents)], ["Kuussa", money(m.monthlyCents)]);
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
          <div className="card-sub">{categoryLabel(s.category)}</div>
        </div>
      </div>
      <Facts facts={facts} />
    </section>
  );
}

/** Labelled figures, a label with its value: the merchant's card and the head of the list show them alike. */
function Facts({ facts }: { facts: [string, string][] }) {
  return (
    <dl className="kv">
      {facts.map(([k, v]) => (
        <div key={k}>
          <dt className="k">{k}</dt>
          <dd className="v">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const PAGE = 100;
const MAX_ROWS = 500;

/**
 * Two views of the same rows: the list, and the merchants with the rules under them. The merchant list takes a period
 * (`from`, `to`) that the list shares, so a merchant's rows open for the period its figures add up.
 */
export function Transactions({ meta, params, scope, anchor }: { meta: Meta; params: URLSearchParams; scope: Scope; anchor?: string }) {
  const merchants = params.get("view") === "merchants";
  const period = { from: params.get("from") ?? "", to: params.get("to") ?? "" };
  return (
    <div className="stack">
      <div className="segmented view-tabs" role="group" aria-label="Tapahtumat ja kauppiaat">
        <button type="button" aria-pressed={!merchants} onClick={() => navigate("transactions", period)}>
          Tapahtumat
        </button>
        <button type="button" aria-pressed={merchants} onClick={() => navigate("transactions", { view: "merchants", ...period })}>
          Kauppiaat
        </button>
      </div>
      {merchants ? <Merchants meta={meta} params={params} scope={scope} anchor={anchor} /> : <TransactionList meta={meta} params={params} scope={scope} />}
    </div>
  );
}

function TransactionList({ meta, params, scope }: { meta: Meta; params: URLSearchParams; scope: Scope }) {
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
  const phone = usePhone();
  const [panel, setPanel] = useState(false);
  const { data, error, loading, reload } = useApi<{ total: number; inCents: number; outCents: number; items: ListedRow[] }>(`/api/transactions${query({ ...filters, scope, limit })}`);
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
      const merchant = merchantOf.current.get(id) ?? "";
      // a row without a merchant name changes alone: its placeholder merchant stands for every unnamed row
      const createRule = rememberRef.current && merchant !== UNKNOWN_MERCHANT;
      setSaving({ id, category });
      setSaveError(null);
      setChanged(null);
      try {
        const r = await api<{ changed?: number }>(`/api/transactions/${encodeURIComponent(id)}`, { method: "PATCH", body: { category, createRule } });
        setChanged({
          count: typeof r?.changed === "number" ? r.changed : 1,
          merchant,
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
  // on a phone the answer to a change floats above the list (it would be off screen at the top), so it leaves by itself
  useEffect(() => {
    if (!phone || !changed) return;
    const timer = window.setTimeout(() => setChanged(null), 8000);
    return () => window.clearTimeout(timer);
  }, [phone, changed]);

  const anyFilter = Object.values(filters).some(Boolean);
  // Every matching row, loaded or not; an own transfer is in none of the sums, and in the own view they add up the
  // viewer's parts of a joint account's rows (the server's). With a merchant filter the merchant's card states them.
  const facts: [string, string][] = [];
  if (data && data.total > 0 && !filters.merchant) {
    facts.push(["Tapahtumia", String(data.total)]);
    if (data.outCents > 0) facts.push(["Maksettu yhteensä", money(data.outCents)]);
    if (data.inCents > 0) facts.push(["Saatu yhteensä", money(data.inCents)]);
  }
  // the search box and the merchant badge are always in view, so only the filters behind the button count
  const active = [filters.category, filters.accountId, filters.from, filters.to].filter(Boolean).length;
  const fields = (
    <>
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
    </>
  );
  const merchantFilter = <FilterChip label={filters.merchant} removeLabel="Poista kauppiaan rajaus" onRemove={() => set({ merchant: "" })} />;
  const clear = anyFilter && (
    <button className="btn btn-small" onClick={() => navigate("transactions")}>
      Tyhjennä
    </button>
  );
  const csv = (
    <a className="btn btn-small" href={`/api/export/transactions.csv${query({ ...filters, from: filters.from || "2000-01-01", to: filters.to || meta.today, scope })}`} download>
      Lataa CSV
    </a>
  );
  const rowProps = (t: ListedRow) => ({
    t,
    categories: meta.categories,
    categoryLabel: categoryLabel(t.category),
    pending: saving?.id === t.id ? saving.category : null,
    onCategory: recategorize,
  });

  return (
    <div className="stack">
      {filters.merchant && <MerchantSummary merchant={filters.merchant} scope={scope} refresh={edits} categoryLabel={categoryLabel} />}
      {!filters.merchant && !filters.q && (
        <Uncategorised
          categories={meta.categories}
          scope={scope}
          refresh={edits}
          onSaved={reload}
        />
      )}
      <div className="filters">
        <SearchBox value={filters.q} onSearch={(q) => set({ q })} label="Hae kauppiasta tai viestiä" />
        {phone ? (
          <>
            <FilterToggle count={active} open={panel} onToggle={() => setPanel((v) => !v)} controls="tx-filter-panel" />
            {filters.merchant && <div className="filter-line">{merchantFilter}</div>}
            <div id="tx-filter-panel" className="filter-panel" hidden={!panel}>
              {fields}
              {clear}
            </div>
          </>
        ) : (
          <>
            {fields}
            {filters.merchant && merchantFilter}
            {clear}
          </>
        )}
      </div>

      <div className={`card tx-card ${loading ? "loading" : ""}`}>
        <div className="card-head tx-head">
          <h2 className={phone ? "sr-only" : undefined}>Tapahtumat</h2>
          <div className="form-row" style={{ margin: 0 }}>
            {anyOwn && (
              <label>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Sama kategoria kauppiaan muille tapahtumille
              </label>
            )}
            {!phone && csv}
          </div>
        </div>
        {facts.length > 0 && <Facts facts={facts} />}
        {error && (
          <div className="error" role="alert">
            {error}{" "}
            <button className="btn btn-small" type="button" onClick={reload}>
              Yritä uudelleen
            </button>
          </div>
        )}
        {/* on a phone this floats at the bottom of the screen: the row that was changed is far from the top of the card */}
        <div className="tx-feedback">
          {saveError && (
            <div className="error" role="alert">
              {saveError}
              {phone && (
                <button className="icon-btn" type="button" onClick={() => setSaveError(null)} aria-label="Sulje">
                  ×
                </button>
              )}
            </div>
          )}
          {changed !== null && !saveError && (
            <div className="notice good" role="status">
              {changed.rule && changed.merchant
                ? `${changed.merchant}: ${plural(changed.count, "tapahtuma", "tapahtumaa")} siirrettiin kategoriaan ${changed.category}, samoin tulevat.`
                : `Tapahtuma siirrettiin kategoriaan ${changed.category}.`}
              {phone && (
                <button className="icon-btn" type="button" onClick={() => setChanged(null)} aria-label="Sulje">
                  ×
                </button>
              )}
            </div>
          )}
        </div>
        <div className="table-wrap">
          {phone ? (
            byDay(data?.items ?? []).map((d) => (
              <div key={d.day} className="tx-day">
                <h3>{dayHeading(d.day, meta.today)}</h3>
                <ul>
                  {d.items.map((t) => (
                    <TxItem key={t.id} {...rowProps(t)} />
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Päivä</th>
                  <th>Saaja/maksaja</th>
                  <th className="tx-account">Tili</th>
                  <th className="tx-category">Kategoria</th>
                  <th className="num">Summa</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((t) => (
                  <TxRow key={t.id} {...rowProps(t)} account={accountName(t.accountId)} />
                ))}
              </tbody>
            </table>
          )}
          {data && !data.items.length && (
            <div className="empty">
              {anyFilter ? (
                "Ei tapahtumia näillä rajauksilla."
              ) : (
                <>
                  Ei tapahtumia. <a href="#/settings?add=1">Yhdistä pankki</a>
                </>
              )}
            </div>
          )}
        </div>
        {(phone || (data && data.total > data.items.length)) && (
          <div className="form-row">
            {data && data.total > data.items.length && (
              <>
                <button className="btn" onClick={() => setPaging({ key: filterKey, limit: limit + PAGE })} disabled={loading || limit >= MAX_ROWS}>
                  Näytä lisää
                </button>
                {limit >= MAX_ROWS && <span className="small muted">Näytetään enintään {MAX_ROWS}. Rajaa hakua.</span>}
              </>
            )}
            {/* the table's head has it on a wider screen; here the head is only the summary */}
            {phone && csv}
          </div>
        )}
      </div>
    </div>
  );
}

interface UncategorisedItem {
  merchant: string;
  totalCents: number;
}

/**
 * Merchants that landed in "Muut menot" by default, largest first. Picking a
 * category saves a rule for the merchant, so the rows and future ones move.
 */
function Uncategorised({
  categories,
  scope,
  refresh,
  onSaved,
}: {
  categories: Category[];
  scope: Scope;
  /** Changes when a category was changed in the list below. */
  refresh: number;
  onSaved: () => void;
}) {
  const { data, reload } = useApi<{ items: UncategorisedItem[] }>(`/api/merchants/uncategorised${query({ scope })}`);
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
        <h2>Luokittelematta</h2>
        <a className="btn btn-small" href="#/transactions?category=other">
          Näytä kaikki
        </a>
      </div>
      {error && <div className="error">{error}</div>}
      <ul className="uncat-list">
        {rows.map((m) => (
          <li key={m.merchant}>
            <a href={`#/transactions${query({ merchant: m.merchant })}`}>{m.merchant}</a>
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
