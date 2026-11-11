/** Asetukset > Pankit ja tilit: the rows of a bank's CSV export or camt.053 statement the file picker found, to check and save. Only the rows are sent. */
// Decision: a household whose bank gives an account's rows only as a file matches the columns once, and the file itself never leaves the browser (ADR 0025)
import { type BankCamtError, type BankCamtRead, type BankCsvLayout, type BankCsvTable, bankCsvKey, readBankCamt, guessBankCsvLayout, isBankCsvLayout, parseBankCsv, readBankCsvRows, splitRowsByDay } from "@banking/core";
import { useMemo, useState } from "react";
import { api, ApiError } from "../../api.ts";
import { Table } from "../../components/table/Table.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { date, money } from "../../format.ts";
import type { Meta } from "../../types.ts";
import { t } from "../../text.ts";

type Problem = "table" | "camt" | "currency" | "accounts" | "balance" | "entry" | "mismatch" | "empty" | "many" | "save";

/** The layouts the household settled on stay in this browser, under the header of the bank's file: the header names no row. */
const STORE = "omatalous.bank-csv-layout:";

function recall(table: BankCsvTable): BankCsvLayout | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE + bankCsvKey(table.header)) ?? "null") as BankCsvLayout | null;
    return saved && saved.delimiter === table.delimiter && isBankCsvLayout(saved, table.header.length) ? saved : null;
  } catch {
    return null;
  }
}

/** What the text of the picked file is: a camt.053 statement, or a CSV table with its columns guessed or remembered. */
function open(text: string) {
  if (/^\uFEFF?\s*</.test(text)) {
    // XML: a camt.053 statement, whose closing balance is checked against its rows before anything is shown
    const r = readBankCamt(text);
    return { table: null, layout: null, known: false, camt: "error" in r ? { refused: r } : { read: r } };
  }
  const table = parseBankCsv(text);
  if (!table) return { table: null, layout: null, known: false, camt: null };
  const remembered = recall(table);
  return { table, layout: remembered ?? guessBankCsvLayout(table) ?? { delimiter: table.delimiter, amount: null, debit: null, credit: null }, known: remembered !== null, camt: null };
}

/** `text` is the file as the picker read it; a new pick mounts this again (`key`). */
export function BankRows({ text, meta, onChange }: { text: string; meta: Meta; onChange: () => void }) {
  const [start] = useState(() => open(text));
  const [table, setTable] = useState<BankCsvTable | null>(start.table);
  const [layout, setLayout] = useState<Partial<BankCsvLayout> | null>(start.layout);
  const [known, setKnown] = useState(start.known);
  const [problem, setProblem] = useState<Problem | null>(start.table || start.camt ? null : "table");
  const [camt, setCamt] = useState<{ read: BankCamtRead } | { refused: BankCamtError } | null>(start.camt);
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [leftOut, setLeftOut] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // the file's own accounts, and the user's bank-connected checking accounts, which the file fills in (the sync skips what the file holds)
  const accounts = meta.accounts.filter((a) => a.provider === "bankfile" || (a.provider === "enablebanking" && a.type === "checking"));

  const full = layout && table && layout.date != null && layout.text != null && isBankCsvLayout(layout as BankCsvLayout, table.header.length) ? (layout as BankCsvLayout) : null;
  const read = useMemo(() => (table && full ? readBankCsvRows(table, full) : null), [table, full]);
  const csvFound = read && !("error" in read) ? read : null;
  const found = camt ? ("read" in camt ? camt.read : null) : csvFound;
  const split = layout?.amount == null && (layout?.debit != null || layout?.credit != null);

  const set = (patch: Partial<BankCsvLayout>) => {
    setKnown(false);
    // a text column the household picks replaces the guessed fallbacks
    setLayout((l) => ({ ...l, ...patch, ...("text" in patch ? { more: undefined, textIn: undefined } : {}) }));
  };

  const save = async () => {
    if (!found || (!camt && (!full || !table))) return;
    setSaving(true);
    setProblem(null);
    setRefusal(null);
    setLeftOut(null);
    setSaved(null);
    // a row dated after today is left out and named; the others are saved
    const today = new Date().toLocaleDateString("sv-SE");
    const future = found.rows.filter((row) => row.day > today);
    const rows = found.rows.filter((row) => row.day <= today);
    if (!rows.length) {
      setRefusal(t("card_file.future"));
      setSaving(false);
      return;
    }
    try {
      // the rows only: no file, no header, no columns of the file around them
      // a year is sent in parts of whole days, each within the route's limit
      const r = { inserted: 0, fetched: 0, skipped: 0 };
      let accountId = account || null;
      for (const part of splitRowsByDay(rows)) {
        const one = await api<{ inserted: number; fetched: number; skipped?: number; accountId?: string }>("/api/bank-file", {
          method: "POST",
          body: { accountId, name: accountId ? null : name, last4: null, rows: part },
        });
        r.inserted += one.inserted;
        r.fetched += one.fetched;
        r.skipped += one.skipped ?? 0;
        accountId = accountId ?? one.accountId ?? null;
      }
      try {
        if (table && full) localStorage.setItem(STORE + bankCsvKey(table.header), JSON.stringify(full));
      } catch {
        // a browser that keeps nothing asks for the columns again
      }
      const skipped = r.skipped ?? 0;
      setSaved(t("card_file.saved", { inserted: r.inserted, known: r.fetched - r.inserted - skipped }) + (skipped ? ` ${t("card_file.skipped", { count: skipped })}` : ""));
      if (future[0]) setLeftOut(t(future.length === 1 ? "card_file.left_out" : "card_file.left_out_many", { count: future.length, day: date(future[0].day), text: future[0].text }));
      setTable(null);
      setCamt(null);
      onChange();
    } catch (e) {
      // the server's own sentence says why; only an answer without one is "try again"
      if (e instanceof ApiError && e.messageCode) setRefusal(e.message);
      else setProblem("save");
    } finally {
      setSaving(false);
    }
  };

  const refused = camt && "refused" in camt ? camt.refused : null;
  const camtProblem: Record<BankCamtError["error"], Problem> = { not_camt: "camt", no_rows: "empty", too_many_rows: "many", currency: "currency", accounts: "accounts", no_balance: "balance", unreadable: "entry", mismatch: "mismatch" };
  const error: Record<Problem, string> = {
    table: t("bank_file.err_table"),
    camt: t("bank_file.err_camt"),
    currency: t("bank_file.err_camt_currency"),
    accounts: t("bank_file.err_camt_accounts"),
    balance: t("bank_file.err_camt_balance"),
    entry: t("bank_file.err_camt_entry"),
    mismatch: refused?.error === "mismatch" ? t("bank_file.err_camt_mismatch", { closing: money(refused.closing), opening: money(refused.opening), expected: money(refused.expected), difference: money(refused.difference) }) : "",
    empty: t("card_file.err_empty"),
    many: t("card_file.err_many", { max: 1000 }),
    save: t("card_file.err_save"),
  };
  const shown = problem ?? (refused ? camtProblem[refused.error] : null) ?? (read && "error" in read ? (read.error === "too_many_rows" ? "many" : "empty") : null);

  const column = (label: string, key: "date" | "text" | "amount" | "debit" | "credit", optional = false) => (
    <label>
      <span className="field-label">{label}</span>
      <select value={layout?.[key] ?? ""} onChange={(e) => set({ [key]: e.target.value === "" ? null : Number(e.target.value) })}>
        {(optional || layout?.[key] == null) && <option value="">{t("bank_file.none")}</option>}
        {table?.header.map((h, i) => (
          // eslint-disable-next-line react/no-array-index-key -- the columns of a file have no other identity
          <option key={i} value={i}>
            {h || String(i + 1)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="stack">
        {shown && <Notice tone="warning">{error[shown]}</Notice>}
        {refusal && <Notice tone="warning">{refusal}</Notice>}
        {saved && <Notice tone="good">{saved}</Notice>}
        {leftOut && <Notice tone="warning">{leftOut}</Notice>}
        {table && (
          <>
            <h3>{t("bank_file.columns")}</h3>
            <div className="form-row">
              {column(t("bank_file.col_date"), "date")}
              {column(t("bank_file.col_text"), "text")}
              {split ? (
                <>
                  {column(t("bank_file.col_debit"), "debit")}
                  {column(t("bank_file.col_credit"), "credit")}
                </>
              ) : (
                column(t("bank_file.col_amount"), "amount")
              )}
              <label>
                <input
                  type="checkbox"
                  checked={split}
                  onChange={(e) => set(e.target.checked ? { amount: null, debit: layout?.debit ?? 0, credit: layout?.credit ?? 0 } : { debit: null, credit: null })}
                />{" "}
                {t("bank_file.split")}
              </label>
            </div>
            {known && <span className="field-help">{t("bank_file.remembered")}</span>}
            {!full && <p>{t("bank_file.need")}</p>}
          </>
        )}
        {found && (
          <>
            <p>{t("card_file.found", { rows: found.rows.length, from: date(found.periodFrom), to: date(found.periodTo) })}</p>
            {found.unread.length > 0 && <Notice tone="warning">{t("card_file.unread", { count: found.unread.length })}</Notice>}
            <Table
              caption={t("card_file.caption")}
              rows={found.rows.map((r, i) => ({ ...r, i }))}
              rowKey={(r) => String(r.i)}
              columns={[
                { key: "day", label: t("card_file.col_day"), kind: "date", cell: (r) => date(r.day) },
                { key: "text", label: t("card_file.col_text"), kind: "text", rowHead: true, cell: (r) => r.text },
                { key: "sum", label: t("card_file.col_sum"), kind: "money", cell: (r) => money(r.cents) },
              ]}
            />
            <div className="form-row">
              <label>
                <span className="field-label">{t("bank_file.account")}</span>
                <select value={account} onChange={(e) => setAccount(e.target.value)}>
                  <option value="">{t("bank_file.account_new")}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.provider === "bankfile" ? a.name : t("bank_file.account_connected", { name: a.name })}
                    </option>
                  ))}
                </select>
              </label>
              {!account && (
                <label>
                  <span className="field-label">{t("bank_file.name")}</span>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("bank_file.default_name")} />
                </label>
              )}
              <Button variant="primary" onClick={() => void save()} busy={saving} disabled={!account && !name.trim()}>
                {t("card_file.save")}
              </Button>
            </div>
          </>
        )}
    </div>
  );
}
