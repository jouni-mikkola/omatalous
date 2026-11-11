import { type ReactNode, useRef, useState } from "react";
import { api } from "../../api.ts";
import { KeyValue } from "../../components/table/KeyValue.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { date } from "../../format.ts";
import { labelTable, t } from "../../text.ts";
/** One store of the dry run's answer (docs/DATA_EXPORT.md, "The dry run's answer"). */
type StorePlan = {
  key: string;
  add: number;
  exists: number;
  skipped: { reason: string; n: number }[];
};
type Totals = { add: number; exists: number; skipped: number };
type Plan = {
  session: string;
  head: { version: number; appVersion: string | null; exportedAt: string | null };
  stores: StorePlan[];
  total: Totals;
  committed: boolean;
};

/** The server sends the keys of the file's stores only. */
const STORE_LABELS: Record<string, string> = labelTable({
  users: () => t("set.imp.users"),
  accounts: () => t("set.imp.accounts"),
  accountShares: () => t("set.imp.account_sharing"),
  transactions: () => t("set.imp.transactions"),
  rules: () => t("set.imp.rules"),
  marks: () => t("set.imp.marks"),
  answers: () => t("set.imp.answers_about_account_owners"),
  accountSplits: () => t("set.imp.account_splits"),
  accountUse: () => t("set.imp.account_use"),
  parts: () => t("set.imp.parts_of_transactions"),
  loans: () => t("set.imp.loans"),
  expectedBills: () => t("set.imp.expected_bills"),
  spendingGoals: () => t("set.imp.monthly_spending_goal"),
  categoryGoals: () => t("set.imp.category_spending_goals"),
  optimiseInputs: () => t("set.imp.inputs_of_the_savings_tips"),
  optimiseStates: () => t("set.imp.decisions_on_the_savings_tips"),
  optimiseSnapshots: () => t("set.imp.snapshots_of_the_savings_tips"),
  accountBalances: () => t("set.imp.account_balances"),
  accountHistory: () => t("set.imp.account_history"),
  statementBills: () => t("set.imp.card_bills"),
  statementRows: () => t("set.imp.rows_of_card_bills"),
  foreignRows: () => t("set.imp.foreign_currency_transactions"),
  payerRoles: () => t("set.imp.roles_of_payers"),
  householdMembers: () => t("set.imp.household_members"),
  accountAgreements: () => t("set.imp.account_agreements"),
  valuedAssets: () => t("set.imp.asset_values"),
  contractTerms: () => t("set.imp.contract_terms"),
});

const REASONS: Record<string, string> = labelTable({
  other_user: () => t("set.imp.another_user_s"),
  users: () => t("set.imp.not_imported"),
  sharing: () => t("set.imp.not_imported"),
  household: () => t("set.imp.not_imported_only_the_administrator"),
  refused: () => t("set.imp.not_imported_does_not_match"),
});

const notOurs = () => t("set.imp.the_file_is_not_an");
const HEAD_KEYS = [
  "format",
  "version",
  "appVersion",
  "exportedAt",
  "exportedBy",
] as const;

type Chunk = { seq: number; stores: Record<string, unknown[]> };

/** What the file is, said before any count: its date first, so a reader sees at once whether it is the file they meant. */
export function fileLine(head: Plan["head"]): string {
  const when = head.exportedAt ? t("set.imp.exported_on", { date: date(head.exportedAt) }) : t("set.imp.no_export_date");
  return t("set.imp.file_line", { when }) + (head.appVersion ? t("set.imp.file_version", { version: head.appVersion }) : "");
}

/** Splits the arrays of the file into chunks of at most `limit` bytes of JSON; a row over the limit goes alone, the server refuses it. */
function chunks(file: Record<string, unknown>, limit: number): Chunk[] {
  const encoder = new TextEncoder();
  const out: Chunk[] = [];
  let stores: Record<string, unknown[]> = {};
  let size = 0;
  const flush = () => {
    if (Object.keys(stores).length > 0) out.push({ seq: out.length, stores });
    stores = {};
    size = 0;
  };
  for (const [key, rows] of Object.entries(file)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const bytes = encoder.encode(JSON.stringify(row)).length + 1;
      // the key and its brackets are counted once per chunk; the margin below the server's cap covers the rest
      if (size > 0 && size + bytes + key.length + 8 > limit) flush();
      const list = (stores[key] ??= []);
      size += bytes + (list.length === 0 ? key.length + 8 : 0);
      list.push(row);
    }
  }
  flush();
  return out;
}

const counts = (totals: Totals, done: boolean) =>
  t(done ? "set.imp.counts_done" : "set.imp.counts_plan", { add: totals.add, exists: totals.exists, skipped: totals.skipped });

function storeLine(s: StorePlan): string {
  const skipped = s.skipped.reduce((n, r) => n + r.n, 0);
  const why = [...new Set(s.skipped.map((r) => REASONS[r.reason] ?? r.reason))];
  return `${counts({ add: s.add, exists: s.exists, skipped }, false)}${why.length > 0 ? ` (${why.join(", ")})` : ""}`;
}

/**
 * Asetukset > Pankit ja tilit > "Tuo tiedot": reads the file of "Vie kaikki tiedot", stages it on the server, shows the dry run and
 * commits on "Tuo". It sits in the card head beside the export button; what it prints wraps to its own lines.
 */
export function DataImport() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(
    null,
  );
  const [plan, setPlan] = useState<Plan | null>(null);
  const [done, setDone] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    setPlan(null);
    setDone(null);
    try {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(await file.text()) as Record<string, unknown>;
      } catch {
        throw new Error(notOurs());
      }
      if (body === null || typeof body !== "object" || Array.isArray(body))
        throw new Error(notOurs());
      const head = Object.fromEntries(HEAD_KEYS.map((k) => [k, body[k]]));
      const started = await api<{
        session: string;
        limits: { chunkBytes: number };
      }>("/api/data/import", { method: "POST", body: head });
      const parts = chunks(body, started.limits.chunkBytes);
      for (const part of parts) {
        setProgress({ at: part.seq + 1, of: parts.length });
        await api(`/api/data/import/${started.session}/chunk`, {
          method: "POST",
          body: part,
        });
      }
      setPlan(
        await api<Plan>(`/api/data/import/${started.session}/check`, {
          method: "POST",
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const commit = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      setDone(
        await api<Plan>(`/api/data/import/${plan.session}/commit`, {
          method: "POST",
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPlan(null);
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!plan) return;
    setBusy(true);
    setCancelling(true);
    try {
      await api(`/api/data/import/${plan.session}`, { method: "DELETE" });
    } catch {
      // the session ends by itself after fifteen minutes
    }
    setPlan(null);
    setBusy(false);
    setCancelling(false);
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])}
      />
      <Button
        
        disabled={busy || plan !== null}
        aria-busy={busy}
        onClick={() => input.current?.click()}
      >
        {t("set.imp.import_data")}
      </Button>
      {progress && (
        <div className="data-import-line">
          <progress value={progress.at} max={progress.of} aria-label={t("set.imp.import")} />{" "}
          {t("set.imp.part", { at: progress.at, of: progress.of })}
        </div>
      )}
      {plan && (
        <div className="data-import-line">
          <KeyValue
            className="data-import-plan"
            items={[
              [t("set.imp.file"), fileLine(plan.head)],
              ...plan.stores.map((s): [string, ReactNode] => [
                STORE_LABELS[s.key] ?? s.key,
                storeLine(s),
              ]),
              [t("set.imp.total"), counts(plan.total, false)],
            ]}
          />
          <div className="data-import-actions">
            <Button
              variant="primary"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void commit()}
            >
              {t("set.imp.import_2")}
            </Button>
            <Button
              
              disabled={busy}
              aria-busy={busy && cancelling}
              onClick={() => void cancel()}
            >
              {t("set.imp.cancel")}
            </Button>
          </div>
        </div>
      )}
      {done && (
        <div className="data-import-line" role="status">
          <strong>{t("set.imp.imported")}</strong>: {counts(done.total, true)}
        </div>
      )}
      {error && <Notice tone="error" className="data-import-line">{error}</Notice>}
    </>
  );
}
