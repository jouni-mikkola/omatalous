import { MAX_LIST_ROWS, UNKNOWN_MERCHANT, LOCALE } from "@banking/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, query } from "../api.ts";
import { CardStatement, type SavedStatement } from "../components/cards/CardStatement.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { CADENCE_LABEL, date, money } from "../format.ts";
import { navigate, useApi } from "../hooks.ts";
import { t, tn } from "../text.ts";
import type { CategoryUndo, Meta, Scope } from "../types.ts";
import { Merchants } from "./Merchants.tsx";
import { type DaySum, type ListedRow, rowChips, RowsSkeleton, TxTable, usePhone } from "./TransactionRows.tsx";
import { accountLooks } from "./transactions/Marks.tsx";
import { type Filters, FilterChips } from "./transactions/FilterChips.tsx";
import { StripSkeleton, type Totals, TotalsStrip } from "./transactions/TotalsStrip.tsx";
import "../styles/transactions.css";
import { SEARCH_DELAY_MS } from "../components/FilterInputs.tsx";
import type { TableView } from "../components/table/Table.tsx";
import { loadTableParts } from "../components/table/use-markup.ts";
import { Button } from "../components/ui/Button.tsx";
import { IconButton } from "../components/ui/IconButton.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Segmented } from "../components/ui/Segmented.tsx";
import { Empty } from "../components/ui/Empty.tsx";
import { CONNECT_BANK_HASH } from "../routes.ts";
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
    if (s.outCents > 0) facts.push([t("tx.sum_out"), money(s.outCents)]);
    if (s.inCents > 0) facts.push([t("tx.sum_in"), money(s.inCents)]);
    facts.push([t("tx.payments"), String(s.count)]);
  }
  const m = s.monthly;
  if (m.fromSeries) facts.push([t("tx.per_month"), m.monthlyCents === null ? "–" : money(m.monthlyCents)], [t("tx.per_year"), money(m.yearCents)]);
  else if (m.monthlyCents) facts.push([m.months === 1 ? t("tx.last_full_month") : t("tx.last_months", { months: m.months }), money(m.yearCents)], [t("tx.per_month"), money(m.monthlyCents)]);
  facts.push([t("tx.first"), date(s.firstDate)], [t("tx.latest"), date(s.lastDate)]);
  if (s.recurring?.active) {
    facts.push([t("tx.repeats"), CADENCE_LABEL[s.recurring.cadence] ?? s.recurring.cadence]);
    if (s.recurring.nextDate) facts.push([t("tx.next_expected"), date(s.recurring.nextDate)]);
  }
  return (
    <section className="card" aria-label={t("tx.summary_of", { merchant: s.merchant })}>
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
const count = (n: number): string => n.toLocaleString(LOCALE);

/**
 * Two views of the same rows: the list, and the merchants with the rules under them. The merchant list takes a period
 * (`from`, `to`) that the list shares, so a merchant's rows open for the period its figures add up.
 */
export function Transactions({ meta, params, scope, anchor }: { meta: Meta; params: URLSearchParams; scope: Scope; anchor?: string }) {
  // the table parts load while the first answer is on its way, so the rows come with their toolbar
  useEffect(() => void loadTableParts(), []);
  const merchants = params.get("view") === "merchants";
  const period = { from: params.get("from") ?? "", to: params.get("to") ?? "" };
  return (
    <div className="stack">
      <Segmented
        className="view-tabs"
        label={t("tx.tabs")}
        value={merchants ? "merchants" : "transactions"}
        options={[{ value: "transactions", label: t("tx.tab_list") }, { value: "merchants", label: t("tx.tab_merchants") }]}
        onChange={(v) => navigate("transactions", v === "merchants" ? { view: "merchants", ...period } : period)}
      />
      {merchants ? <Merchants meta={meta} params={params} scope={scope} anchor={anchor} /> : <TransactionList meta={meta} params={params} scope={scope} />}
    </div>
  );
}

interface ListAnswer extends Totals {
  items: ListedRow[];
  daySums?: DaySum[];
}

function TransactionList({ meta, params, scope }: { meta: Meta; params: URLSearchParams; scope: Scope }) {
  const accounts = [...meta.accounts, ...(scope === "household" ? meta.sharedAccounts : [])];
  const filters: Filters = {
    q: params.get("q") ?? "",
    chip: rowChips().some((c) => c.key === params.get("chip")) ? params.get("chip")! : "",
    category: params.get("category") ?? "",
    kind: params.get("kind") === "income" ? "income" : "",
    // a shared account stays in the address after switching back to the own view
    accountId: accounts.some((a) => a.id === params.get("accountId")) ? params.get("accountId")! : "",
    merchant: params.get("merchant") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  const filterKey = `${scope}?${params.toString()}`;
  const phone = usePhone();
  const [remember, setRemember] = useState(true);
  const rememberRef = useRef(remember);
  rememberRef.current = remember;
  const [saving, setSaving] = useState<{ id: string; category: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [changed, setChanged] = useState<{ id: string; count: number; merchant: string; category: string; rule: boolean; undo: CategoryUndo } | null>(null);
  // the answer to "Kumoa": the line that says the change is back, in the place of the one that offered it
  const [undone, setUndone] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [ownTransfer, setOwnTransfer] = useState<{ id: string; category: string } | null>(null);
  const [edits, setEdits] = useState(0);
  const [opened, setOpened] = useState<string | null>(null);
  // the chip narrows the rows the table has; the server does not know it
  const serverFilters = { ...filters, chip: undefined };
  const { data, error, loading, reload } = useApi<ListAnswer>(`/api/transactions${query({ ...serverFilters, scope, limit: MAX_LIST_ROWS })}`);
  const statements = useApi<{ statements: SavedStatement[] }>("/api/statements");
  const [billOpen, setBillOpen] = useState<ListedRow | null>(null);
  const savedOf = (id: string) => statements.data?.statements?.find((s) => s.billId === id) ?? null;
  const transferIds = useRef(new Set<string>());
  transferIds.current = new Set(data?.items.filter((t) => t.isTransfer).map((t) => t.id));
  const merchantOf = useRef(new Map<string, string>());
  merchantOf.current = new Map(data?.items.map((t) => [t.id, t.merchant]));
  const looks = useMemo(() => accountLooks(meta), [meta]);
  const daySums = useMemo(() => new Map((data?.daySums ?? []).map((d) => [d.date, d])), [data]);

  const set = (patch: Partial<Filters>) => navigate("transactions", { ...filters, ...patch });
  // the search box shows what is typed at once; the address (and so the server) follows after a pause
  const [draft, setDraft] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    setDraft(filters.q);
  }
  useEffect(() => {
    if (draft.trim() === filters.q) return;
    const timer = window.setTimeout(() => navigate("transactions", { ...filters, q: draft.trim() }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filters is read from the render of this filterKey
  }, [draft, filterKey]);
  const view: TableView = { query: draft, chip: filters.chip || null, group: null, sort: null };
  const onView = (next: TableView) => {
    setDraft(next.query);
    if ((next.chip ?? "") !== filters.chip) set({ chip: next.chip ?? "" });
  };
  const categoryLabel = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;

  // stable, so the rows (memo) do not re-render while the user types or ticks the box
  const recategorize = useCallback(
    async (id: string, category: string, confirmed = false) => {
      // an own transfer is neutral; giving it a spending category counts the money twice
      const kind = meta.categories.find((c) => c.id === category)?.kind;
      if (!confirmed && transferIds.current.has(id) && kind !== "transfer") {
        setOwnTransfer({ id, category });
        return;
      }
      const merchant = merchantOf.current.get(id) ?? "";
      // a row without a merchant name changes alone: its placeholder merchant stands for every unnamed row
      const createRule = rememberRef.current && merchant !== UNKNOWN_MERCHANT;
      setSaving({ id, category });
      setSaveError(null);
      setChanged(null);
      setUndone(false);
      try {
        const r = await api<{ changed?: number; undo: CategoryUndo }>(`/api/transactions/${encodeURIComponent(id)}`, { method: "PATCH", body: { category, createRule } });
        setChanged({
          id,
          undo: r.undo,
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
  const undoChange = async () => {
    if (!changed || undoing) return;
    setUndoing(true);
    setSaveError(null);
    try {
      await api(`/api/transactions/${encodeURIComponent(changed.id)}/undo-category`, { method: "POST", body: changed.undo });
      setChanged(null);
      setUndone(true);
      setEdits((n) => n + 1);
      reload();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setUndoing(false);
    }
  };
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
  const note = remember ? t("tx.note_remember") : t("tx.note_only");
  const rowProps = (t: ListedRow) => ({
    t,
    categories: meta.categories,
    pending: saving?.id === t.id ? saving.category : null,
    onCategory: recategorize,
    note,
    look: looks.get(t.accountId),
    account: looks.get(t.accountId)?.name ?? t.accountId,
    remember,
    onRemember: setRemember,
    explained: savedOf(t.id)?.read ? savedOf(t.id)!.explainedCents : null,
    onStatement: setBillOpen,
  });

  return (
    <div className="stack tx-page">
      {ownTransfer && (
        <ConfirmDialog
          title={t("tx.own_ask")}
          confirmLabel={t("tx.own_confirm")}
          onConfirm={() => {
            const { id, category } = ownTransfer;
            setOwnTransfer(null);
            void recategorize(id, category, true);
          }}
          onCancel={() => setOwnTransfer(null)}
        >
          <p>{t("tx.own_note")}</p>
        </ConfirmDialog>
      )}
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
          />
        </div>
      )}

      {error && !data ? (
        <ErrorCard message={error} onRetry={reload} />
      ) : (
        <section className={`card tx-card ${loading ? "loading" : ""}`} aria-label={t("nav.transactions")}>
          {error && (
            <Notice tone="error">
              {error}{" "}
              <Button onClick={reload}>
                {t("load.retry")}
              </Button>
            </Notice>
          )}
          {/* on a phone this floats at the bottom of the screen: the row that was changed is far from the top of the card */}
          <div className="tx-feedback">
            {saveError && (
              <Notice tone="error">
                {saveError}
                {phone && (
                  <IconButton label={t("ui.close")} onClick={() => setSaveError(null)}>
                    ×
                  </IconButton>
                )}
              </Notice>
            )}
            {changed !== null && !saveError && (
              <Notice tone="good" role="status" action={<Button variant="link" busy={undoing} onClick={() => void undoChange()}>{t("bills.undo")}</Button>}>
                {changed.rule && changed.merchant
                  ? tn(changed.count, "tx.moved_rule_one", "tx.moved_rule_many", { merchant: changed.merchant, category: changed.category })
                  : t("tx.moved", { category: changed.category })}
                {phone && (
                  <IconButton label={t("ui.close")} onClick={() => setChanged(null)}>
                    ×
                  </IconButton>
                )}
              </Notice>
            )}
            {undone && changed === null && !saveError && (
              <Notice tone="info" role="status">
                {t("tx.undone")}
                {phone && (
                  <IconButton label={t("ui.close")} onClick={() => setUndone(false)}>
                    ×
                  </IconButton>
                )}
              </Notice>
            )}
          </div>
          <div>
            {data && data.items.length > 0 && <TxTable items={data.items} severalAccounts={accounts.length > 1} today={meta.today} daySums={daySums} rowProps={rowProps} scope={scope} open={opened} onOpen={setOpened} view={view} onView={onView} searchLabel={t("tx.search")} filters={<FilterChips filters={filters} severalAccounts={accounts.length > 1} categories={meta.categories} accounts={accounts} looks={looks} today={meta.today} set={set} clear={() => navigate("transactions")} />} />}
            {/* before the first answer the page is loading, not empty: grey rows stand where the list will */}
            {!data && !error && <RowsSkeleton />}
            {data && !data.items.length && (
              <Empty>
                {anyFilter ? (
                  <>
                    {t("tx.no_match")}{" "}
                    <Button variant="link" onClick={() => navigate("transactions")}>
                      {t("tx.clear")}
                    </Button>
                  </>
                ) : (
                  <>
                    {t("tx.none_a")} <a href={CONNECT_BANK_HASH}>{t("start.connect")}</a>, {t("tx.none_b")}
                  </>
                )}
              </Empty>
            )}
          </div>
          {data && data.total > data.items.length && (
            <p className="small muted tx-cut">
              {t("tx.cut", { shown: count(data.items.length), total: count(data.total) })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
