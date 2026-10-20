import { UNKNOWN_MERCHANT } from "@banking/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, query } from "../api.ts";
import { CardStatement, type SavedStatement } from "../components/cards/CardStatement.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { type Density, DensitySwitch, useDensity } from "../components/table/RichTable.tsx";
import { CADENCE_LABEL, date, money, plural } from "../format.ts";
import { navigate, useApi } from "../hooks.ts";
import type { Meta, Scope } from "../types.ts";
import { CalendarHeat, type HeatDay } from "../charts/CalendarHeat.tsx";
import { Merchants } from "./Merchants.tsx";
import { type DaySum, type ListedRow, RowsSkeleton, TxCards, TxTable, usePhone } from "./TransactionRows.tsx";
import { accountLooks } from "./transactions/Marks.tsx";
import { type Filters, FilterBar } from "./transactions/FilterBar.tsx";
import { Popover } from "./transactions/Popover.tsx";
import { StripSkeleton, type Totals, TotalsStrip } from "./transactions/TotalsStrip.tsx";
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
 * pick. It loads on its own, so a slow history never holds the list back. `alone`: the merchant is the only filter,
 * so the strip above already says what was paid, received and how many rows: the card does not say it again.
 */
function MerchantSummary({ merchant, scope, refresh, alone, categoryLabel }: { merchant: string; scope: Scope; refresh: number; alone: boolean; categoryLabel: (id: string) => string }) {
  const { data, reload } = useApi<{ summary: MerchantHistory | null }>(`/api/merchants/summary${query({ merchant, scope })}`);
  // a category changed in the list below moves the category shown here
  useEffect(() => {
    if (refresh > 0) reload();
  }, [refresh, reload]);
  const s = data?.summary;
  if (!s || s.merchant !== merchant) return null;
  const facts: [string, string][] = [];
  if (!alone) {
    if (s.outCents > 0) facts.push(["Maksettu yhteensä", money(s.outCents)]);
    if (s.inCents > 0) facts.push(["Saatu yhteensä", money(s.inCents)]);
    facts.push(["Maksuja", String(s.count)]);
  }
  const m = s.monthly;
  if (m.fromSeries) facts.push(["Kuussa", m.monthlyCents === null ? "–" : money(m.monthlyCents)], ["Vuodessa", money(m.yearCents)]);
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

/** A count of rows with its thousands set apart, as the cut mark prints it. */
const count = (n: number): string => n.toLocaleString("fi-FI");

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

interface ListAnswer extends Totals {
  items: ListedRow[];
  daySums?: DaySum[];
  /** Every day of the last 53 weeks of the span with its shade (core `calendarDays`), for the rhythm calendar. */
  calendar?: { days: HeatDay[]; usualCents: number | null } | null;
}

/** The quiet menu of the list's head: the download, the rule a category change makes, the density. */
function ListMenu({ csv, remember, setRemember, density, setDensity, ownRows }: { csv: string; remember: boolean; setRemember: (v: boolean) => void; density: Density; setDensity: (d: Density) => void; ownRows: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <span className="tx-menu-wrap">
      <button ref={button} type="button" className="icon-btn tx-menu-btn" aria-haspopup="dialog" aria-expanded={open} aria-label="Listan asetukset" onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.3" />
          <circle cx="8" cy="8" r="1.3" />
          <circle cx="12.5" cy="8" r="1.3" />
        </svg>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={button} label="Listan asetukset" className="tx-menu">
        {ownRows && (
          <label className="tx-menu-item">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>
              Sama kategoria kauppiaan muille tapahtumille
              <span className="tx-menu-sub">Myös tulevat tapahtumat saavat saman kategorian.</span>
            </span>
          </label>
        )}
        <div className="tx-menu-item">
          <span>Rivien tiheys</span>
          <DensitySwitch density={density} onChange={setDensity} />
        </div>
        <a className="tx-menu-item tx-menu-link" href={csv} download onClick={() => setOpen(false)}>
          Lataa CSV
          <span className="tx-menu-sub">Rajatut tapahtumat taulukkona</span>
        </a>
      </Popover>
    </span>
  );
}

function TransactionList({ meta, params, scope }: { meta: Meta; params: URLSearchParams; scope: Scope }) {
  const accounts = [...meta.accounts, ...(scope === "household" ? meta.sharedAccounts : [])];
  const filters: Filters = {
    q: params.get("q") ?? "",
    category: params.get("category") ?? "",
    kind: params.get("kind") === "income" ? "income" : "",
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
  const [opened, setOpened] = useState<string | null>(null);
  const [chart, setChart] = useState<"bars" | "calendar">("bars");
  const [density, setDensity] = useDensity("transactions");
  const phone = usePhone();
  const { data, error, loading, reload } = useApi<ListAnswer>(`/api/transactions${query({ ...filters, scope, limit })}`);
  const statements = useApi<{ statements: SavedStatement[] }>("/api/statements");
  const [billOpen, setBillOpen] = useState<ListedRow | null>(null);
  const savedOf = (id: string) => statements.data?.statements?.find((s) => s.billId === id) ?? null;
  const anyOwn = data?.items.some((t) => t.own) ?? false;
  const transferIds = useRef(new Set<string>());
  transferIds.current = new Set(data?.items.filter((t) => t.isTransfer).map((t) => t.id));
  const merchantOf = useRef(new Map<string, string>());
  merchantOf.current = new Map(data?.items.map((t) => [t.id, t.merchant]));
  const looks = useMemo(() => accountLooks(meta), [meta]);
  const daySums = useMemo(() => new Map((data?.daySums ?? []).map((d) => [d.date, d])), [data]);

  const set = (patch: Partial<Filters>) => navigate("transactions", { ...filters, ...patch });
  const categoryLabel = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;
  const toggle = useCallback((id: string) => setOpened((o) => (o === id ? null : id)), []);

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
  // the saved value shows until the reload settles; a failed reload must not leave the chip disabled
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
  // the calendar answers a span of four weeks or more; a shorter one is a few cells
  const rhythm = (data?.calendar?.days.length ?? 0) >= 28;
  const csv = `/api/export/transactions.csv${query({ ...filters, from: filters.from || "2000-01-01", to: filters.to || meta.today, scope })}`;
  const note = remember ? "Muutos koskee myös kauppiaan muita ja tulevia tapahtumia." : "Muutos koskee vain tätä tapahtumaa.";
  const rowProps = (t: ListedRow) => ({
    t,
    categories: meta.categories,
    pending: saving?.id === t.id ? saving.category : null,
    onCategory: recategorize,
    note,
    look: looks.get(t.accountId),
    account: looks.get(t.accountId)?.name ?? t.accountId,
    explained: savedOf(t.id)?.read ? savedOf(t.id)!.explainedCents : null,
    onStatement: setBillOpen,
    open: opened === t.id,
    onToggle: toggle,
  });

  return (
    <div className="stack tx-page">
      {billOpen && (
        <CardStatement
          key={billOpen.id}
          bill={{ id: billOpen.id, bookingDate: billOpen.bookingDate, amountCents: billOpen.amountCents, merchant: billOpen.merchant }}
          saved={savedOf(billOpen.id)}
          onClose={() => setBillOpen(null)}
          onChanged={() => {
            statements.reload();
            reload();
            setEdits((n) => n + 1);
          }}
        />
      )}
      <FilterBar filters={filters} categories={meta.categories} accounts={accounts} looks={looks} today={meta.today} set={set} clear={() => navigate("transactions")} />
      {filters.merchant && <MerchantSummary merchant={filters.merchant} scope={scope} refresh={edits} alone={Object.entries(filters).every(([k, v]) => k === "merchant" || !v)} categoryLabel={categoryLabel} />}
      {!data && !error && <StripSkeleton />}
      {data && data.total > 0 && (
        <div className="tx-totals-wrap">
          <TotalsStrip
            totals={data}
            income={filters.kind === "income"}
            merchant={filters.merchant}
            whole={!filters.from && !filters.to}
            today={meta.today}
            onPick={(p) => set(p)}
            tool={
              rhythm ? (
                <div className="segmented tx-chart-switch" role="group" aria-label="Kuvan muoto">
                  <button type="button" aria-pressed={chart === "bars"} onClick={() => setChart("bars")}>
                    Pylväät
                  </button>
                  <button type="button" aria-pressed={chart === "calendar"} onClick={() => setChart("calendar")}>
                    Kalenteri
                  </button>
                </div>
              ) : undefined
            }
          />
          {/* the rhythm of the filtered rows: VC3's calendar of the days the server shaded */}
          {rhythm && chart === "calendar" && data.calendar && (
            <div className="tx-rhythm">
              <CalendarHeat
                question={filters.kind === "income" ? "Minä päivinä rahaa tuli?" : "Minä päivinä rahaa meni?"}
                days={data.calendar.days}
                usualCents={data.calendar.usualCents}
                today={meta.today}
                countName="Tapahtumia"
              />
            </div>
          )}
        </div>
      )}

      {error && !data ? (
        <ErrorCard message={error} onRetry={reload} />
      ) : (
        <section className={`card tx-card ${loading ? "loading" : ""}`} aria-labelledby="tx-title">
          <div className="card-head tx-head">
            <h2 id="tx-title">Tapahtumat</h2>
            {data && data.total > 0 && (
              <span className="tx-head-datum">
                {data.total > data.items.length ? `${count(data.items.length)} / ${count(data.total)}` : plural(data.total, "tapahtuma", "tapahtumaa")}
              </span>
            )}
            <ListMenu csv={csv} remember={remember} setRemember={setRemember} density={density} setDensity={setDensity} ownRows={anyOwn} />
          </div>
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
                  ? `${changed.merchant}: ${plural(changed.count, "tapahtuma", "tapahtumaa")} siirrettiin kategoriaan ${changed.category}. Myös tulevat tapahtumat menevät sinne.`
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
              <TxCards items={data?.items ?? []} today={meta.today} daySums={daySums} rowProps={rowProps} scope={scope} />
            ) : (
              <TxTable items={data?.items ?? []} today={meta.today} density={density} daySums={daySums} rowProps={rowProps} scope={scope} />
            )}
            {/* before the first answer the page is loading, not empty: the table's head stands, grey rows under it */}
            {!data && !error && <RowsSkeleton density={density} />}
            {data && !data.items.length && (
              <div className="empty">
                {anyFilter ? (
                  <>
                    Näillä rajauksilla ei ole tapahtumia.{" "}
                    <button type="button" className="btn btn-small" onClick={() => navigate("transactions")}>
                      Tyhjennä rajaukset
                    </button>
                  </>
                ) : (
                  <>
                    Tapahtumia ei vielä ole. <a href="#/settings?add=1">Yhdistä pankki</a>
                  </>
                )}
              </div>
            )}
          </div>
          {data && data.total > data.items.length && (
            <div className="form-row tx-more">
              <span className="cut-mark">
                1–{count(data.items.length)} / {count(data.total)}
              </span>
              <button className="btn" onClick={() => setPaging({ key: filterKey, limit: limit + PAGE })} disabled={loading || limit >= MAX_ROWS}>
                Näytä lisää
              </button>
              {limit >= MAX_ROWS && <span className="small muted">Näytetään enintään {MAX_ROWS}. Rajaa hakua.</span>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
